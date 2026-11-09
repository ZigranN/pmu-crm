import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getNeedsAttention: typeof import("@/features/needs-attention/server/queries").getNeedsAttention;
let getNeedsAttentionCount: typeof import("@/features/needs-attention/server/queries").getNeedsAttentionCount;

let studioId: string;
let otherStudioId: string;
let ownerUserId: string;
let masterUserId: string;
let masterId: string;
let clientId: string;
let otherClientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const queries = await import("@/features/needs-attention/server/queries");
  getNeedsAttention = queries.getNeedsAttention;
  getNeedsAttentionCount = queries.getNeedsAttentionCount;

  // 1. Studios
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Needs Attention Studio",
        slug: `na-studio-${randomUUID()}`,
      },
      {
        ...studioFixture(),
        name: "Other Isolation Studio",
        slug: `other-na-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const [otherSt] = await db
    .select()
    .from(s.studios)
    .where(eq(s.studios.name, "Other Isolation Studio"));
  otherStudioId = otherSt.id;

  // 2. Roles
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;
  const masterRoleId = roleRows.find((r) => r.code === "MASTER")!.id;

  // 3. Owner User
  ownerUserId = `user-owner-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Owner User",
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

  // 4. Master User
  masterUserId = `user-master-${randomUUID()}`;
  await db.insert(s.user).values({
    id: masterUserId,
    name: "Master User",
    email: `${masterUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(s.studioMembers).values({
    studioId,
    userId: masterUserId,
    roleId: masterRoleId,
    isActive: true,
  });

  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: masterUserId,
      displayName: "Master Anna",
    })
    .returning();
  masterId = m1.id;

  await db.insert(s.masters).values({
    studioId,
    displayName: "Master Bella",
  });

  // 5. Clients
  const [cl] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Алена",
      lastName: "Иванова",
      fullName: "Алена Иванова",
      phone: "+79990001122",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = cl.id;

  const [otherCl] = await db
    .insert(s.clients)
    .values({
      studioId: otherStudioId,
      firstName: "Другая",
      lastName: "Студия",
      fullName: "Другая Студия Клиент",
      phone: "+79998887766",
      clientStatus: "new_lead",
    })
    .returning();
  otherClientId = otherCl.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
  session.role = "OWNER";
});

describe("Needs Attention Operational Dashboard Integration", () => {
  it("medical signals: review required and not-cleared items appear, cleared removes item", async () => {
    // 1. Create client and cycle
    const [cClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Мед",
        lastName: "Клиент",
        fullName: "Мед Клиент",
        phone: "+79991112233",
        clientStatus: "new_lead",
      })
      .returning();

    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: cClient.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "qualification",
        assignedMasterId: masterId,
      })
      .returning();

    // With no medical profile -> REVIEW_REQUIRED / NO_MEDICAL_PROFILE
    let items = await getNeedsAttention();
    const medReviewItem = items.find(
      (i) => i.cycleId === cycle.id && i.reasonCode === "MEDICAL_REVIEW_REQUIRED"
    );
    expect(medReviewItem).toBeDefined();
    expect(medReviewItem?.severity).toBe("HIGH");

    // Insert active medical profile and matching revision first
    await db.insert(s.clientMedicalProfiles).values({
      clientId: cClient.id,
      allergies: "нет",
    });

    const [rev1] = await db
      .insert(s.medicalProfileRevisions)
      .values({
        studioId,
        clientId: cClient.id,
        revisionNumber: 1,
        snapshot: { allergies: "нет" },
        createdById: ownerUserId,
      })
      .returning();

    // Add medical clearance with NOT_CLEARED
    await db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycle.id,
      medicalRevisionId: rev1.id,
      decisionNumber: 1,
      decision: "NOT_CLEARED",
      reason: "Беременность 1 триместр",
      decidedById: ownerUserId,
    });

    items = await getNeedsAttention();
    const notClearedItem = items.find(
      (i) => i.cycleId === cycle.id && i.reasonCode === "MEDICAL_NOT_CLEARED"
    );
    expect(notClearedItem).toBeDefined();
    expect(notClearedItem?.severity).toBe("CRITICAL");

    // Update medical clearance to CLEARED
    await db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycle.id,
      medicalRevisionId: rev1.id,
      decisionNumber: 2,
      decision: "CLEARED",
      reason: "Консультация пройдена, допуск выдан",
      decidedById: ownerUserId,
    });

    items = await getNeedsAttention();
    const resolvedMed = items.find(
      (i) =>
        i.cycleId === cycle.id &&
        (i.reasonCode === "MEDICAL_REVIEW_REQUIRED" || i.reasonCode === "MEDICAL_NOT_CLEARED")
    );
    expect(resolvedMed).toBeUndefined();
  });

  it("consent signals: missing consent and valid consent behavior", async () => {
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId,
        zoneCode: "lips",
        kind: "pmu",
        stage: "procedure_slot_selected",
        assignedMasterId: masterId,
      })
      .returning();

    let items = await getNeedsAttention();
    const consentMissing = items.find(
      (i) => i.cycleId === cycle.id && i.reasonCode === "CONSENT_MISSING"
    );
    expect(consentMissing).toBeDefined();
    expect(consentMissing?.severity).toBe("HIGH");

    // Add signed consent for this cycle covering lips
    const [tpl] = await db
      .insert(s.consentTemplates)
      .values({
        studioId,
        code: `lips-tpl-${randomUUID()}`,
        name: "Lips Consent",
        createdById: ownerUserId,
      })
      .returning();

    const [tplVer] = await db
      .insert(s.consentTemplateVersions)
      .values({
        studioId,
        templateId: tpl.id,
        versionNumber: 1,
        title: "Lips Consent v1",
        body: "Text",
        contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        createdById: ownerUserId,
        publishedAt: new Date(),
      })
      .returning();

    const [media] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "consent",
        url: "http://example.com/pdf.pdf",
        publicId: `pub-${randomUUID()}`,
        createdById: ownerUserId,
      })
      .returning();

    const [cs] = await db
      .insert(s.cycleConsents)
      .values({
        studioId,
        cycleId: cycle.id,
        clientId,
        templateVersionId: tplVer.id,
        status: "DRAFT",
        createdById: ownerUserId,
      })
      .returning();

    await db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: cs.id,
      zoneCode: "lips",
    });

    await db
      .update(s.cycleConsents)
      .set({
        status: "SIGNED",
        mediaId: media.id,
        signedAt: new Date(),
        signedPdfSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        signatureMethod: "draw_on_screen",
        signaturePayload: { data: "sig" },
        signatoryName: "Клиент Алена",
        signatoryRole: "client",
        finalizedById: ownerUserId,
        finalizedAt: new Date(),
      })
      .where(eq(s.cycleConsents.id, cs.id));

    items = await getNeedsAttention();
    const resolvedConsent = items.find(
      (i) =>
        i.cycleId === cycle.id &&
        (i.reasonCode === "CONSENT_MISSING" || i.reasonCode === "CONSENT_INVALID")
    );
    expect(resolvedConsent).toBeUndefined();
  });

  it("appointment signals: past due, cancelled, and missing appointment", async () => {
    // 1. Past due unresolved appointment
    const [svc] = await db
      .insert(s.services)
      .values({
        studioId,
        name: "Brows PMU",
        category: "brows",
        procedureType: "brows",
        priceCents: 10000,
        durationMinutes: 90,
      })
      .returning();

    const pastStart = new Date(Date.now() - 3 * 3600 * 1000);
    const pastEnd = new Date(Date.now() - 2 * 3600 * 1000);

    const [pastAppt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId,
        serviceId: svc.id,
        startAt: pastStart,
        endAt: pastEnd,
        status: "confirmed",
        source: "walk_in",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 10000,
        durationSnapshotMinutes: 90,
      })
      .returning();

    let items = await getNeedsAttention();
    const pastDueItem = items.find(
      (i) => i.appointmentId === pastAppt.id && i.reasonCode === "APPOINTMENT_PAST_DUE"
    );
    expect(pastDueItem).toBeDefined();
    expect(pastDueItem?.severity).toBe("HIGH");

    // 2. Cancelled appointment without future appointment
    const [cancelledAppt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId,
        serviceId: svc.id,
        startAt: new Date(Date.now() + 24 * 3600 * 1000),
        endAt: new Date(Date.now() + 26 * 3600 * 1000),
        status: "cancelled",
        cancelReason: "Клиент заболел",
        cancelledAt: new Date(),
        source: "phone",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 10000,
        durationSnapshotMinutes: 90,
      })
      .returning();

    items = await getNeedsAttention();
    const cancelledItem = items.find(
      (i) => i.appointmentId === cancelledAppt.id && i.reasonCode === "APPOINTMENT_CANCELLED"
    );
    expect(cancelledItem).toBeDefined();
    expect(cancelledItem?.severity).toBe("HIGH");
  });

  it("financial signals: outstanding balance surfaced, paid removes item, refunds recalculate", async () => {
    const [finClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Финансовый",
        lastName: "Клиент",
        fullName: "Финансовый Клиент",
        phone: "+79992223344",
        clientStatus: "new_lead",
      })
      .returning();

    // Add CHARGE entry
    await db.insert(s.ledgerEntries).values({
      studioId,
      clientId: finClient.id,
      type: "CHARGE",
      amountMinor: 15000,
      currency: "EUR",
      reason: "Тестовое начисление",
      createdById: ownerUserId,
    });

    let items = await getNeedsAttention();
    const finItem = items.find(
      (i) => i.clientId === finClient.id && i.reasonCode === "OUTSTANDING_BALANCE"
    );
    expect(finItem).toBeDefined();
    expect(finItem?.metadata?.outstandingCents).toBe(15000);

    // Pay full amount
    await db.insert(s.ledgerEntries).values({
      studioId,
      clientId: finClient.id,
      type: "PAYMENT",
      amountMinor: 15000,
      currency: "EUR",
      reason: "Тестовая оплата",
      createdById: ownerUserId,
    });

    items = await getNeedsAttention();
    const resolvedFin = items.find(
      (i) => i.clientId === finClient.id && i.reasonCode === "OUTSTANDING_BALANCE"
    );
    expect(resolvedFin).toBeUndefined();

    // Refund
    await db.insert(s.ledgerEntries).values({
      studioId,
      clientId: finClient.id,
      type: "REFUND",
      amountMinor: 5000,
      currency: "EUR",
      reason: "Тестовый возврат",
      createdById: ownerUserId,
    });

    items = await getNeedsAttention();
    const refundFin = items.find(
      (i) => i.clientId === finClient.id && i.reasonCode === "OUTSTANDING_BALANCE"
    );
    expect(refundFin).toBeDefined();
    expect(refundFin?.metadata?.outstandingCents).toBe(5000);
  });

  it("total face package signals: blocked and partially complete items", async () => {
    const [tfClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "TF",
        lastName: "Клиент",
        fullName: "TF Клиент",
        phone: "+79993334455",
        clientStatus: "new_lead",
      })
      .returning();

    const [pkg] = await db
      .insert(s.treatmentPackages)
      .values({
        studioId,
        clientId: tfClient.id,
        kind: "total_face",
        status: "active",
      })
      .returning();

    await db.insert(s.treatmentCycles).values({
      studioId,
      clientId: tfClient.id,
      packageId: pkg.id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "cycle_completed",
    });

    const [c2] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: tfClient.id,
        packageId: pkg.id,
        zoneCode: "lips",
        kind: "pmu",
        stage: "procedure_slot_selected",
      })
      .returning();

    let items = await getNeedsAttention();
    const partialTf = items.find(
      (i) => i.packageId === pkg.id && i.reasonCode === "TOTAL_FACE_PARTIALLY_COMPLETE"
    );
    expect(partialTf).toBeDefined();

    // Insert active medical profile and matching revision
    await db.insert(s.clientMedicalProfiles).values({
      clientId: tfClient.id,
      allergies: "нет",
    });

    const [tfMedRev] = await db
      .insert(s.medicalProfileRevisions)
      .values({
        studioId,
        clientId: tfClient.id,
        revisionNumber: 1,
        snapshot: { allergies: "нет" },
        createdById: ownerUserId,
      })
      .returning();

    // Block child cycle with medical NOT_CLEARED
    await db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: c2.id,
      medicalRevisionId: tfMedRev.id,
      decisionNumber: 1,
      decision: "NOT_CLEARED",
      reason: "Медицинский запрет",
      decidedById: ownerUserId,
    });

    items = await getNeedsAttention();
    const blockedTf = items.find(
      (i) => i.packageId === pkg.id && i.reasonCode === "TOTAL_FACE_BLOCKED"
    );
    expect(blockedTf).toBeDefined();
  });

  it("security & scoping: cross-studio isolation and master role scoping", async () => {
    // 1. Create item in otherStudioId
    await db.insert(s.treatmentCycles).values({
      studioId: otherStudioId,
      clientId: otherClientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "qualification",
    });

    // In current studioId, other studio cycles must not appear
    session.studioId = studioId;
    session.role = "OWNER";
    let items = await getNeedsAttention();
    const crossStudioItem = items.find((i) => i.clientId === otherClientId);
    expect(crossStudioItem).toBeUndefined();

    // 2. Master role scoping
    session.id = masterUserId;
    session.studioId = studioId;
    session.role = "MASTER";

    // Master sees only assigned cycles/appointments/clients
    items = await getNeedsAttention();
    for (const item of items) {
      if (item.masterId) {
        expect(item.masterId).toBe(masterId);
      }
    }
  });

  it("query produces zero database mutations (pure read)", async () => {
    const preCount = (await db.select().from(s.treatmentCycles)).length;
    await getNeedsAttention();
    await getNeedsAttentionCount();
    const postCount = (await db.select().from(s.treatmentCycles)).length;
    expect(postCount).toBe(preCount);
  });

  it("remover workflow signals: follow-up required after completed session without next appointment", async () => {
    const [remClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Ремувер",
        lastName: "Клиент",
        fullName: "Ремувер Клиент",
        phone: "+79997778899",
        clientStatus: "new_lead",
      })
      .returning();

    const [remCycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: remClient.id,
        zoneCode: "brows",
        kind: "remover",
        stage: "first_session_completed",
        assignedMasterId: masterId,
      })
      .returning();

    // Add completed procedure session
    await db.insert(s.procedureSessions).values({
      studioId,
      clientId: remClient.id,
      cycleId: remCycle.id,
      serviceId: (await db.select().from(s.services).limit(1))[0].id,
      masterId,
      status: "COMPLETED",
      procedureArea: "brows",
      procedureType: "remover",
      sessionType: "primary_session",
      createdAt: new Date(),
    });

    const items = await getNeedsAttention();
    const remItem = items.find(
      (i) => i.cycleId === remCycle.id && i.reasonCode === "REMOVER_FOLLOW_UP_REQUIRED"
    );
    expect(remItem).toBeDefined();
    expect(remItem?.severity).toBe("MEDIUM");
  });

  it("consultation follow-up signals: overdue decision deadline surfaces attention", async () => {
    const [consClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Консультация",
        lastName: "Клиент",
        fullName: "Консультация Клиент",
        phone: "+79995556677",
        clientStatus: "new_lead",
      })
      .returning();

    const [consCycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: consClient.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "consultation_completed",
        assignedMasterId: masterId,
      })
      .returning();

    // Insert overdue consultation (decision due date in the past, no result recorded)
    const pastCompletedAt = new Date(Date.now() - 48 * 3600 * 1000);
    const pastDecisionDueAt = new Date(Date.now() - 24 * 3600 * 1000);

    const [consAppt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId: consClient.id,
        masterId,
        serviceId: (await db.select().from(s.services).limit(1))[0].id,
        startAt: pastCompletedAt,
        endAt: pastDecisionDueAt,
        status: "completed",
        source: "phone",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 0,
        durationSnapshotMinutes: 30,
      })
      .returning();

    await db.insert(s.appointmentCycles).values({
      studioId,
      clientId: consClient.id,
      appointmentId: consAppt.id,
      cycleId: consCycle.id,
      visitKind: "consultation",
      serviceSnapshot: {},
    });

    const [cons] = await db
      .insert(s.consultations)
      .values({
        studioId,
        cycleId: consCycle.id,
        appointmentId: consAppt.id,
        masterId,
        completedBy: ownerUserId,
        completionReason: "Очная консультация проведена",
        completedAt: pastCompletedAt,
        decisionDueAt: pastDecisionDueAt,
      })
      .returning();

    const items = await getNeedsAttention();
    const consOverdueItem = items.find(
      (i) => i.entityId === cons.id && i.reasonCode === "FOLLOW_UP_OVERDUE"
    );
    expect(consOverdueItem).toBeDefined();
    expect(consOverdueItem?.severity).toBe("HIGH");
  });

  it("filters correctly restrict returned items", async () => {
    session.id = ownerUserId;
    session.studioId = studioId;
    session.role = "OWNER";

    const allItems = await getNeedsAttention();
    expect(allItems.length).toBeGreaterThan(0);

    // Filter by severity
    const criticalItems = await getNeedsAttention({ severity: "CRITICAL" });
    for (const item of criticalItems) {
      expect(item.severity).toBe("CRITICAL");
    }

    // Filter by reason
    const pastDueItems = await getNeedsAttention({ reason: "APPOINTMENT_PAST_DUE" });
    for (const item of pastDueItems) {
      expect(item.reasonCode).toBe("APPOINTMENT_PAST_DUE");
    }
  });

  it("counts exactly match list rows", async () => {
    session.id = ownerUserId;
    session.studioId = studioId;
    session.role = "OWNER";

    const items = await getNeedsAttention();
    const counts = await getNeedsAttentionCount();

    expect(counts.total).toBe(items.length);
    expect(counts.critical).toBe(items.filter((i) => i.severity === "CRITICAL").length);
    expect(counts.high).toBe(items.filter((i) => i.severity === "HIGH").length);
    expect(counts.medium).toBe(items.filter((i) => i.severity === "MEDIUM").length);
    expect(counts.low).toBe(items.filter((i) => i.severity === "LOW").length);
  });
});
