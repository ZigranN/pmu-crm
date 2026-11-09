import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let startProcedureSession: typeof import("../../src/features/procedures/server/service").startProcedureSession;
let completeProcedureSession: typeof import("../../src/features/procedures/server/service").completeProcedureSession;
let abortProcedureSession: typeof import("../../src/features/procedures/server/service").abortProcedureSession;

let studioId: string;
let ownerUserId: string;
let masterId: string;
let clientId: string;
let consentTemplateVersionId: string;
let medicalRevision1Id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const procService = await import("../../src/features/procedures/server/service");
  startProcedureSession = procService.startProcedureSession;
  completeProcedureSession = procService.completeProcedureSession;
  abortProcedureSession = procService.abortProcedureSession;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Concurrency Test Studio",
        slug: `conc-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Owner User & Membership
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Concurrency Tester",
    email: `${ownerUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(s.studioMembers).values({
    studioId,
    userId: ownerUserId,
    roleId: ownerRoleId,
    isActive: true,
  });

  // 3. Master
  const [m] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: ownerUserId,
      displayName: "Master Concurrency",
      isActive: true,
    })
    .returning();
  masterId = m.id;

  // 4. Client
  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Elena",
      fullName: "Elena Concurrency",
      phone: "+39000000088",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;

  // 5. Service
  await db
    .insert(s.services)
    .values({
      studioId,
      name: "Brows Master Class",
      category: "brows",
      procedureType: "brows",
      priceCents: 30000,
      durationMinutes: 90,
      isActive: true,
    })
    .returning();

  // 6. Consent Template
  const [tmpl] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `tmpl-${randomUUID()}`,
      name: "Brows Consent",
      createdById: ownerUserId,
    })
    .returning();

  const [tmplVer] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: tmpl.id,
      versionNumber: 1,
      title: "PMU Terms",
      body: "Client agrees to PMU terms.",
      contentHash: "c".repeat(64),
      publishedAt: new Date(),
      createdById: ownerUserId,
    })
    .returning();
  consentTemplateVersionId = tmplVer.id;

  // 7. Initial Clean Medical Profile & Revision #1
  await db.insert(s.clientMedicalProfiles).values({
    clientId,
    allergies: "None",
    contraindications: "None",
  });

  const [rev] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId,
      revisionNumber: 1,
      snapshot: {
        allergies: "None",
        contraindications: "None",
        diabetes: false,
        keloidRisk: false,
        autoimmuneDiseases: false,
        bloodThinners: false,
        herpesHistory: false,
        previousPMU: false,
        recentBotoxFillers: false,
        recentPeelingLaser: false,
        skinSensitivity: false,
      },
      createdById: ownerUserId,
    })
    .returning();
  medicalRevision1Id = rev.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

async function createSignedConsent(cycleId: string, zoneCode = "brows") {
  const [med] = await db
    .insert(s.media)
    .values({
      studioId,
      clientId,
      type: "consent",
      url: `https://example.com/consent-${randomUUID()}.pdf`,
      createdById: ownerUserId,
    })
    .returning();

  const [draft] = await db
    .insert(s.cycleConsents)
    .values({
      studioId,
      cycleId,
      clientId,
      templateVersionId: consentTemplateVersionId,
      status: "DRAFT",
      createdById: ownerUserId,
    })
    .returning();

  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode,
  });

  const now = new Date();
  const [signed] = await db
    .update(s.cycleConsents)
    .set({
      status: "SIGNED",
      mediaId: med.id,
      signedPdfSha256: "c".repeat(64),
      signatureMethod: "draw_on_screen",
      signaturePayload: { signature: "base64..." },
      signatoryName: "Elena Concurrency",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: ownerUserId,
      finalizedAt: now,
    })
    .where(eq(s.cycleConsents.id, draft.id))
    .returning();

  return signed;
}

async function createMedicalClearance(cycleId: string, medicalRevisionId = medicalRevision1Id) {
  const [clr] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId,
      cycleId,
      medicalRevisionId,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Clearance recorded",
      decidedById: ownerUserId,
    })
    .returning();
  return clr;
}

describe("Procedure Execution Concurrency & Race Prevention", () => {
  it("prevents TOCTOU when medical profile revision is updated concurrently", async () => {
    // 1. Cycle with clearance for revision #1
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: masterId,
      })
      .returning();

    await createMedicalClearance(cycle.id, medicalRevision1Id);
    await createSignedConsent(cycle.id, "brows");

    // 2. Add revision #2 with clinical change (creating mismatch / stale clearance)
    await db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId,
      revisionNumber: 2,
      snapshot: {
        allergies: "Latex Allergy Added",
        contraindications: "None",
        diabetes: true,
        keloidRisk: false,
        autoimmuneDiseases: false,
        bloodThinners: false,
        herpesHistory: false,
        previousPMU: false,
        recentBotoxFillers: false,
        recentPeelingLaser: false,
        skinSensitivity: false,
      },
      createdById: ownerUserId,
    });

    // 3. Attempting to start procedure evaluates latest state under lock and rejects stale clearance
    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id }
      )
    ).rejects.toThrow(/медицинский допуск не получен/i);
  });

  it("prevents duplicate active procedure starts on the same cycle concurrently", async () => {
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: masterId,
      })
      .returning();

    // Re-create clean revision #3 and clearance
    const [rev3] = await db
      .insert(s.medicalProfileRevisions)
      .values({
        studioId,
        clientId,
        revisionNumber: 3,
        snapshot: {
          allergies: "None",
          contraindications: "None",
          diabetes: false,
          keloidRisk: false,
          autoimmuneDiseases: false,
          bloodThinners: false,
          herpesHistory: false,
          previousPMU: false,
          recentBotoxFillers: false,
          recentPeelingLaser: false,
          skinSensitivity: false,
        },
        createdById: ownerUserId,
      })
      .returning();
    medicalRevision1Id = rev3.id;

    await db
      .update(s.clientMedicalProfiles)
      .set({ allergies: "None", contraindications: "None", diabetes: false })
      .where(eq(s.clientMedicalProfiles.clientId, clientId));

    await createMedicalClearance(cycle.id, rev3.id);
    await createSignedConsent(cycle.id, "brows");

    // Launch two concurrent start attempts
    const results = await Promise.allSettled([
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id, notes: "Attempt A" }
      ),
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id, notes: "Attempt B" }
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify only 1 procedure session is active
    const activeSessions = await db
      .select()
      .from(s.procedureSessions)
      .where(
        and(
          eq(s.procedureSessions.cycleId, cycle.id),
          eq(s.procedureSessions.status, "IN_PROGRESS"),
          eq(s.procedureSessions.studioId, studioId)
        )
      );
    expect(activeSessions.length).toBe(1);
  });

  it("handles race between COMPLETE and ABORT deterministically", async () => {
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: masterId,
      })
      .returning();

    await createMedicalClearance(cycle.id, medicalRevision1Id);
    await createSignedConsent(cycle.id, "brows");

    const session = await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: cycle.id }
    );
    expect(session.status).toBe("IN_PROGRESS");

    // Race complete vs abort concurrently
    const results = await Promise.allSettled([
      completeProcedureSession(
        { studioId, userId: ownerUserId },
        { procedureSessionId: session.id, pigments: [] }
      ),
      abortProcedureSession(
        { studioId, userId: ownerUserId },
        { procedureSessionId: session.id, reason: "Concurrent abort attempt" }
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one operation wins because of row locks and state guard check
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const [finalSession] = await db
      .select()
      .from(s.procedureSessions)
      .where(eq(s.procedureSessions.id, session.id));

    expect(["COMPLETED", "ABORTED"]).toContain(finalSession.status);
  });

  it("handles duplicate completion and idempotent replay safely", async () => {
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: masterId,
      })
      .returning();

    await createMedicalClearance(cycle.id, medicalRevision1Id);
    await createSignedConsent(cycle.id, "brows");

    const session = await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: cycle.id }
    );

    // Concurrent duplicate complete attempts
    const results = await Promise.allSettled([
      completeProcedureSession(
        { studioId, userId: ownerUserId },
        { procedureSessionId: session.id, notes: "Complete A", pigments: [] }
      ),
      completeProcedureSession(
        { studioId, userId: ownerUserId },
        { procedureSessionId: session.id, notes: "Complete B", pigments: [] }
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Sequential second completion attempt also fails closed
    await expect(
      completeProcedureSession(
        { studioId, userId: ownerUserId },
        { procedureSessionId: session.id, pigments: [] }
      )
    ).rejects.toThrow(/в статусе IN_PROGRESS/i);
  });
});
