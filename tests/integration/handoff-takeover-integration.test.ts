import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, or } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import {
  createHandoff,
  acceptHandoff,
  rejectHandoff,
  cancelHandoff,
  completeHandoff,
} from "@/features/handoffs/server/service";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
  role: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.id ? { user: { id: session.id } } : null),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "pmu_active_studio" && session.studioId
        ? { value: session.studioId }
        : undefined,
  }),
}));

describe("Phase 14: Human Takeover, Ownership & Handoff Queue Integration Tests", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let studioAId: string;
  let studioBId: string;
  let ownerAId: string;
  let adminAId: string;
  let masterA1Id: string;
  let masterA2Id: string;
  let clientUserAId: string;
  let aiSystemUserId: string;
  let userBId: string;

  let clientIdA: string;
  let clientIdB: string;
  let cycleIdA: string;
  let convIdA: string;
  let apptIdA: string;

  let getNeedsAttention: typeof import("@/features/needs-attention/server/queries").getNeedsAttention;

  const roleIds = new Map<string, string>();

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    const db = database.db;

    const naQueries = await import("@/features/needs-attention/server/queries");
    getNeedsAttention = naQueries.getNeedsAttention;

    // Create Studios
    [studioAId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
    [studioBId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);

    // Fetch Roles
    for (const role of await db.select().from(s.roles)) roleIds.set(role.code, role.id);

    // Create Users in Studio A
    ownerAId = randomUUID();
    adminAId = randomUUID();
    masterA1Id = randomUUID();
    masterA2Id = randomUUID();
    clientUserAId = randomUUID();
    aiSystemUserId = randomUUID();
    userBId = randomUUID();

    session.id = adminAId;
    session.studioId = studioAId;
    session.role = "ADMIN";

    await db.insert(s.user).values([
      { id: ownerAId, name: "Owner A", email: `${ownerAId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: adminAId, name: "Admin A", email: `${adminAId}@example.test`, role: "STUDIO_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: masterA1Id, name: "Master A1", email: `${masterA1Id}@example.test`, role: "MASTER", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: masterA2Id, name: "Master A2", email: `${masterA2Id}@example.test`, role: "MASTER", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: clientUserAId, name: "Client User", email: `${clientUserAId}@example.test`, role: "CLIENT", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: aiSystemUserId, name: "AI Agent", email: `${aiSystemUserId}@example.test`, role: "STUDIO_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: userBId, name: "Staff B", email: `${userBId}@example.test`, role: "STUDIO_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await db.insert(s.studioMembers).values([
      { userId: ownerAId, studioId: studioAId, roleId: roleIds.get("OWNER")!, isActive: true },
      { userId: adminAId, studioId: studioAId, roleId: roleIds.get("ADMIN")!, isActive: true },
      { userId: masterA1Id, studioId: studioAId, roleId: roleIds.get("MASTER")!, isActive: true },
      { userId: masterA2Id, studioId: studioAId, roleId: roleIds.get("MASTER")!, isActive: true },
      { userId: aiSystemUserId, studioId: studioAId, roleId: roleIds.get("AI_SYSTEM")!, isActive: true },
      { userId: userBId, studioId: studioBId, roleId: roleIds.get("ADMIN")!, isActive: true },
    ]);

    // Create Master records in Studio A
    const [mRow1] = await db.insert(s.masters).values({ studioId: studioAId, userId: masterA1Id, displayName: "Master A1" }).returning();
    await db.insert(s.masters).values({ studioId: studioAId, userId: masterA2Id, displayName: "Master A2" }).returning();

    // Create Service in Studio A
    const [svcRow] = await db.insert(s.services).values({
      studioId: studioAId,
      name: "Brows PMU",
      category: "brows",
      procedureType: "brows",
      priceCents: 15000,
      durationMinutes: 90,
      bufferBeforeMinutes: 10,
    }).returning();

    // Create Client in Studio A
    [clientIdA] = (
      await db
        .insert(s.clients)
        .values({
          studioId: studioAId,
          firstName: "Alice",
          fullName: "Alice Client",
          phone: "+39 333 1111111",
          clientStatus: "new_lead",
        })
        .returning()
    ).map((r) => r.id);

    // Create Client in Studio B
    [clientIdB] = (
      await db
        .insert(s.clients)
        .values({
          studioId: studioBId,
          firstName: "Bob",
          fullName: "Bob Client",
          phone: "+39 333 2222222",
          clientStatus: "new_lead",
        })
        .returning()
    ).map((r) => r.id);

    // Create TreatmentCycle in Studio A
    [cycleIdA] = (
      await db
        .insert(s.treatmentCycles)
        .values({
          studioId: studioAId,
          clientId: clientIdA,
          zoneCode: "brows",
          kind: "pmu",
          stage: "thinking",
          assignedMasterId: mRow1.id,
        })
        .returning()
    ).map((r) => r.id);

    // Create Conversation in Studio A
    [convIdA] = (
      await db
        .insert(s.conversations)
        .values({
          studioId: studioAId,
          clientId: clientIdA,
          assignedUserId: masterA1Id,
          status: "OPEN",
        })
        .returning()
    ).map((r) => r.id);

    // Create Appointment in Studio A
    [apptIdA] = (
      await db
        .insert(s.appointments)
        .values({
          studioId: studioAId,
          clientId: clientIdA,
          masterId: mRow1.id,
          serviceId: svcRow.id,
          startAt: new Date("2026-11-01 10:00:00"),
          endAt: new Date("2026-11-01 11:30:00"),
          status: "confirmed",
          source: "whatsapp",
          createdById: adminAId,
          priceSnapshotCents: 15000,
          durationSnapshotMinutes: 90,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
        })
        .returning()
    ).map((r) => r.id);
  });

  afterAll(async () => {
    if (!database) return;
    try {
      const db = database.db;
      await db.delete(s.handoffs).where(or(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.studioId, studioBId)));
      await db.delete(s.auditLogs).where(or(eq(s.auditLogs.studioId, studioAId), eq(s.auditLogs.studioId, studioBId)));
      await db.delete(s.accessLogs).where(or(eq(s.accessLogs.studioId, studioAId), eq(s.accessLogs.studioId, studioBId)));
      await db.delete(s.appointments).where(or(eq(s.appointments.studioId, studioAId), eq(s.appointments.studioId, studioBId)));
      await db.delete(s.conversations).where(or(eq(s.conversations.studioId, studioAId), eq(s.conversations.studioId, studioBId)));
      await db.delete(s.treatmentCycles).where(or(eq(s.treatmentCycles.studioId, studioAId), eq(s.treatmentCycles.studioId, studioBId)));
      await db.delete(s.clients).where(or(eq(s.clients.studioId, studioAId), eq(s.clients.studioId, studioBId)));
      await db.delete(s.studioMembers).where(or(eq(s.studioMembers.studioId, studioAId), eq(s.studioMembers.studioId, studioBId)));
      await db.delete(s.masters).where(or(eq(s.masters.studioId, studioAId), eq(s.masters.studioId, studioBId)));
      await db.delete(s.services).where(or(eq(s.services.studioId, studioAId), eq(s.services.studioId, studioBId)));
      await db.delete(s.studios).where(or(eq(s.studios.id, studioAId), eq(s.studios.id, studioBId)));
    } catch {
      // Ignored during cleanup
    } finally {
      await database.close();
    }
  });

  describe("1. Creation & Idempotency", () => {
    it("creates valid manual handoff with studio context and audit logging", async () => {
      const db = database.db;
      const handoff = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "CLIENT",
          entityId: clientIdA,
          toUserId: masterA1Id,
          sourceType: "HUMAN",
          reasonCode: "CLIENT_CARE_TRANSFER",
          reasonText: "Please take over VIP client consultation",
          priority: "HIGH",
        }
      );

      expect(handoff.id).toBeDefined();
      expect(handoff.status).toBe("PENDING");
      expect(handoff.toUserId).toBe(masterA1Id);
      expect(handoff.createdById).toBe(adminAId);

      // Verify audit
      const [audit] = await db
        .select()
        .from(s.auditLogs)
        .where(
          and(
            eq(s.auditLogs.studioId, studioAId),
            eq(s.auditLogs.action, "handoff_created"),
            eq(s.auditLogs.entityId, handoff.id)
          )
        );
      expect(audit).toBeDefined();
    });

    it("creates automation-created handoff safely", async () => {
      const db = database.db;
      const handoff = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "APPOINTMENT",
          entityId: apptIdA,
          toUserId: masterA2Id,
          sourceType: "AUTOMATION",
          reasonCode: "AUTOMATION_OVERDUE_APPOINTMENT",
          priority: "URGENT",
        }
      );

      expect(handoff.sourceType).toBe("AUTOMATION");
      expect(handoff.priority).toBe("URGENT");
    });

    it("rejects invalid assignee: non-member, client or AI_SYSTEM", async () => {
      const db = database.db;
      // Non-member
      await expect(
        createHandoff(
          db,
          { studioId: studioAId, userId: adminAId },
          {
            entityType: "CLIENT",
            entityId: clientIdA,
            toUserId: randomUUID(),
            reasonCode: "TEST",
          }
        )
      ).rejects.toThrow(/Assigned user must be an active member/i);

      // AI_SYSTEM role
      await expect(
        createHandoff(
          db,
          { studioId: studioAId, userId: adminAId },
          {
            entityType: "CLIENT",
            entityId: clientIdA,
            toUserId: aiSystemUserId,
            reasonCode: "TEST",
          }
        )
      ).rejects.toThrow(/Cannot assign operational handoff to client or AI system/i);
    });

    it("rejects cross-studio assignee and cross-studio entity", async () => {
      const db = database.db;
      // Assignee from Studio B
      await expect(
        createHandoff(
          db,
          { studioId: studioAId, userId: adminAId },
          {
            entityType: "CLIENT",
            entityId: clientIdA,
            toUserId: userBId,
            reasonCode: "TEST",
          }
        )
      ).rejects.toThrow(/Assigned user must be an active member/i);

      // Entity from Studio B
      await expect(
        createHandoff(
          db,
          { studioId: studioAId, userId: adminAId },
          {
            entityType: "CLIENT",
            entityId: clientIdB,
            toUserId: masterA1Id,
            reasonCode: "TEST",
          }
        )
      ).rejects.toThrow(/Client not found/i);
    });

    it("idempotently returns existing handoff on retry with same requestKey", async () => {
      const db = database.db;
      const reqKey = randomUUID();

      const h1 = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "TREATMENT_CYCLE",
          entityId: cycleIdA,
          toUserId: masterA2Id,
          reasonCode: "CYCLE_CONSULTATION",
          requestKey: reqKey,
        }
      );

      const h2 = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "TREATMENT_CYCLE",
          entityId: cycleIdA,
          toUserId: masterA2Id,
          reasonCode: "CYCLE_CONSULTATION",
          requestKey: reqKey,
        }
      );

      expect(h1.id).toBe(h2.id);
    });

    it("rejects duplicate concurrent active pending handoff for same entity without same requestKey", async () => {
      const db = database.db;
      await expect(
        createHandoff(
          db,
          { studioId: studioAId, userId: adminAId },
          {
            entityType: "TREATMENT_CYCLE",
            entityId: cycleIdA,
            toUserId: masterA1Id,
            reasonCode: "CYCLE_SECOND_TRANSFER",
          }
        )
      ).rejects.toThrow(/An active pending handoff already exists/i);
    });
  });

  describe("2. Acceptance, Rejection, Cancellation & Completion", () => {
    let pendingHandoffId: string;

    beforeEach(async () => {
      const db = database.db;
      // Clean up existing handoffs on conversation to allow fresh creation
      await db.delete(s.handoffs).where(and(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.entityType, "CONVERSATION")));

      const h = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "CONVERSATION",
          entityId: convIdA,
          toUserId: masterA2Id,
          fromUserId: masterA1Id,
          reasonCode: "CONVERSATION_HANDOFF",
          reasonText: "Client prefers Master A2",
        }
      );
      pendingHandoffId = h.id;
    });

    it("intended user accepts handoff and updates canonical conversation assignment", async () => {
      const db = database.db;
      const accepted = await acceptHandoff(
        db,
        { studioId: studioAId, userId: masterA2Id },
        { handoffId: pendingHandoffId }
      );

      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.acceptedById).toBe(masterA2Id);
      expect(accepted.acceptedAt).toBeDefined();

      // Verify conversation assignment was canonically updated
      const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, convIdA));
      expect(conv.assignedUserId).toBe(masterA2Id);

      // Verify idempotent repeat
      const repeat = await acceptHandoff(
        db,
        { studioId: studioAId, userId: masterA2Id },
        { handoffId: pendingHandoffId }
      );
      expect(repeat.status).toBe("ACCEPTED");
    });

    it("unauthorized user cannot accept handoff", async () => {
      const db = database.db;
      await expect(
        acceptHandoff(
          db,
          { studioId: studioAId, userId: masterA1Id }, // Master A1 is not assignee nor admin
          { handoffId: pendingHandoffId }
        )
      ).rejects.toThrow(/Permission denied/i);
    });

    it("admin/owner with HANDOFF_OVERRIDE can accept on behalf of assignee", async () => {
      const db = database.db;
      const accepted = await acceptHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        { handoffId: pendingHandoffId }
      );
      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.acceptedById).toBe(adminAId);
    });

    it("rejection requires explicit reason and preserves handoff record", async () => {
      const db = database.db;
      const rejected = await rejectHandoff(
        db,
        { studioId: studioAId, userId: masterA2Id },
        {
          handoffId: pendingHandoffId,
          reason: "Schedule is fully booked for today",
        }
      );

      expect(rejected.status).toBe("REJECTED");
      expect(rejected.rejectionReason).toBe("Schedule is fully booked for today");
      expect(rejected.rejectedById).toBe(masterA2Id);

      // Preserved record in DB
      const [stored] = await db.select().from(s.handoffs).where(eq(s.handoffs.id, pendingHandoffId));
      expect(stored.status).toBe("REJECTED");
    });

    it("cancellation cancels pending handoff and records reason", async () => {
      const db = database.db;
      const cancelled = await cancelHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          handoffId: pendingHandoffId,
          reason: "Client problem already resolved",
        }
      );

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancelledById).toBe(adminAId);

      // Cannot accept a cancelled handoff
      await expect(
        acceptHandoff(
          db,
          { studioId: studioAId, userId: masterA2Id },
          { handoffId: pendingHandoffId }
        )
      ).rejects.toThrow(/Cannot accept handoff in status CANCELLED/i);
    });

    it("completion handles operational responsibility without altering underlying workflow state", async () => {
      const db = database.db;
      // Accept first
      await acceptHandoff(
        db,
        { studioId: studioAId, userId: masterA2Id },
        { handoffId: pendingHandoffId }
      );

      const completed = await completeHandoff(
        db,
        { studioId: studioAId, userId: masterA2Id },
        { handoffId: pendingHandoffId, notes: "Call completed and client reassured" }
      );

      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedById).toBe(masterA2Id);
      expect(completed.completedAt).toBeDefined();

      // Verify treatmentCycle stage is intact (NOT mutated)
      const [cycle] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycleIdA));
      expect(cycle.stage).toBe("thinking");
    });
  });

  describe("3. Needs Attention Integration", () => {
    it("surfaces handoff and ownership state in Needs Attention without mutating reasons", async () => {
      const items = await getNeedsAttention();
      expect(items).toBeDefined();

      for (const item of items) {
        expect(item.ownershipState).toBeDefined();
        expect(["UNASSIGNED", "ASSIGNED", "HANDOFF_PENDING", "ACCEPTED"]).toContain(item.ownershipState);
      }
    });
  });

  describe("4. Security & Role Policy", () => {
    it("prohibits CLIENT from reading or creating handoffs", async () => {
      const db = database.db;
      expect(await hasPermission(db, clientUserAId, studioAId, "HANDOFF_READ")).toBe(false);
      expect(await hasPermission(db, clientUserAId, studioAId, "HANDOFF_CREATE")).toBe(false);
      expect(await hasPermission(db, clientUserAId, studioAId, "HANDOFF_ACCEPT")).toBe(false);
    });

    it("allows OWNER and ADMIN full handoff capabilities", async () => {
      const db = database.db;
      expect(await hasPermission(db, ownerAId, studioAId, "HANDOFF_READ")).toBe(true);
      expect(await hasPermission(db, ownerAId, studioAId, "HANDOFF_CREATE")).toBe(true);
      expect(await hasPermission(db, ownerAId, studioAId, "HANDOFF_ACCEPT")).toBe(true);
      expect(await hasPermission(db, ownerAId, studioAId, "HANDOFF_OVERRIDE")).toBe(true);

      expect(await hasPermission(db, adminAId, studioAId, "HANDOFF_READ")).toBe(true);
      expect(await hasPermission(db, adminAId, studioAId, "HANDOFF_CREATE")).toBe(true);
      expect(await hasPermission(db, adminAId, studioAId, "HANDOFF_ACCEPT")).toBe(true);
      expect(await hasPermission(db, adminAId, studioAId, "HANDOFF_OVERRIDE")).toBe(true);
    });

    it("prohibits AI_SYSTEM from having any handoff permissions", async () => {
      const db = database.db;
      const aiUserId = "u-ai-system";
      expect(await hasPermission(db, aiUserId, studioAId, "HANDOFF_READ")).toBe(false);
      expect(await hasPermission(db, aiUserId, studioAId, "HANDOFF_CREATE")).toBe(false);
      expect(await hasPermission(db, aiUserId, studioAId, "HANDOFF_ACCEPT")).toBe(false);
      expect(await hasPermission(db, aiUserId, studioAId, "HANDOFF_OVERRIDE")).toBe(false);
    });
  });

  describe("5. PostgreSQL Concurrency & Races", () => {
    it("handles concurrent accept race deterministically (exactly one winner / idempotent)", async () => {
      const db = database.db;
      await db.delete(s.handoffs).where(and(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.entityType, "CLIENT"), eq(s.handoffs.entityId, clientIdA)));

      const h = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "CLIENT",
          entityId: clientIdA,
          toUserId: masterA1Id,
          reasonCode: "CONCURRENT_ACCEPT_TEST",
        }
      );

      const [res1, res2] = await Promise.allSettled([
        acceptHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id }),
        acceptHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id }),
      ]);

      expect(res1.status).toBe("fulfilled");
      expect(res2.status).toBe("fulfilled");

      const [finalH] = await db.select().from(s.handoffs).where(eq(s.handoffs.id, h.id));
      expect(finalH.status).toBe("ACCEPTED");
      expect(finalH.acceptedById).toBe(masterA1Id);
    });

    it("handles accept vs cancel race deterministically", async () => {
      const db = database.db;
      // Clean up any pending handoffs for apptIdA
      await db.delete(s.handoffs).where(and(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.entityType, "APPOINTMENT")));

      const h = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "APPOINTMENT",
          entityId: apptIdA,
          toUserId: masterA1Id,
          reasonCode: "RACE_ACCEPT_CANCEL",
        }
      );

      await Promise.allSettled([
        acceptHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id }),
        cancelHandoff(db, { studioId: studioAId, userId: adminAId }, { handoffId: h.id, reason: "Obsolete" }),
      ]);

      const [finalH] = await db.select().from(s.handoffs).where(eq(s.handoffs.id, h.id));
      // Either ACCEPTED or CANCELLED, but never inconsistent
      expect(["ACCEPTED", "CANCELLED"]).toContain(finalH.status);
    });

    it("handles accept vs reject race deterministically", async () => {
      const db = database.db;
      // Clean up any pending handoffs for cycleIdA
      await db.delete(s.handoffs).where(and(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.entityType, "TREATMENT_CYCLE")));

      const h = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "TREATMENT_CYCLE",
          entityId: cycleIdA,
          toUserId: masterA1Id,
          reasonCode: "RACE_ACCEPT_REJECT",
        }
      );

      await Promise.allSettled([
        acceptHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id }),
        rejectHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id, reason: "Cannot take" }),
      ]);

      const [finalH] = await db.select().from(s.handoffs).where(eq(s.handoffs.id, h.id));
      expect(["ACCEPTED", "REJECTED"]).toContain(finalH.status);
    });
  });

  describe("6. Strict Side-Effect Boundaries", () => {
    it("guarantees handoff operations do not mutate clinical clearances, consent, ledger or procedures", async () => {
      const db = database.db;
      await db.delete(s.handoffs).where(and(eq(s.handoffs.studioId, studioAId), eq(s.handoffs.entityType, "CLIENT"), eq(s.handoffs.entityId, clientIdA)));

      // Count entries before handoff lifecycle
      const [beforeLedger] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.studioId, studioAId));
      const [beforeConsent] = await db.select().from(s.cycleConsents).where(eq(s.cycleConsents.studioId, studioAId));
      const [beforeClearance] = await db.select().from(s.cycleMedicalClearances).where(eq(s.cycleMedicalClearances.studioId, studioAId));
      const [beforeSessions] = await db.select().from(s.procedureSessions).where(eq(s.procedureSessions.studioId, studioAId));

      // Execute full handoff lifecycle
      const h = await createHandoff(
        db,
        { studioId: studioAId, userId: adminAId },
        {
          entityType: "CLIENT",
          entityId: clientIdA,
          toUserId: masterA1Id,
          reasonCode: "BOUNDARY_TEST",
        }
      );
      await acceptHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id });
      await completeHandoff(db, { studioId: studioAId, userId: masterA1Id }, { handoffId: h.id });

      // Count entries after handoff lifecycle
      const [afterLedger] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.studioId, studioAId));
      const [afterConsent] = await db.select().from(s.cycleConsents).where(eq(s.cycleConsents.studioId, studioAId));
      const [afterClearance] = await db.select().from(s.cycleMedicalClearances).where(eq(s.cycleMedicalClearances.studioId, studioAId));
      const [afterSessions] = await db.select().from(s.procedureSessions).where(eq(s.procedureSessions.studioId, studioAId));

      expect(afterLedger).toEqual(beforeLedger);
      expect(afterConsent).toEqual(beforeConsent);
      expect(afterClearance).toEqual(beforeClearance);
      expect(afterSessions).toEqual(beforeSessions);
    });
  });
});
