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
let updateProcedureEvidence: typeof import("../../src/features/procedures/server/service").updateProcedureEvidence;

let getProcedureSession: typeof import("../../src/features/procedures/server/queries").getProcedureSession;
let getCycleProcedureHistory: typeof import("../../src/features/procedures/server/queries").getCycleProcedureHistory;
let getClientProcedureHistory: typeof import("../../src/features/procedures/server/queries").getClientProcedureHistory;

let studioId: string;
let ownerUserId: string;
let masterId: string;
let clientId: string;
let serviceId: string;
let pigment1Id: string;
let pigment2Id: string;
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
  updateProcedureEvidence = procService.updateProcedureEvidence;

  const procQueries = await import("../../src/features/procedures/server/queries");
  getProcedureSession = procQueries.getProcedureSession;
  getCycleProcedureHistory = procQueries.getCycleProcedureHistory;
  getClientProcedureHistory = procQueries.getClientProcedureHistory;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Procedure Test Studio",
        slug: `proc-studio-${randomUUID()}`,
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
    name: "Procedure Tester",
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
      displayName: "Master Anna",
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
      fullName: "Elena Petrova",
      phone: "+39000000005",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;

  // 5. Service
  const [srv] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Brows Powder Effect",
      category: "brows",
      procedureType: "brows",
      priceCents: 25000,
      durationMinutes: 120,
      isActive: true,
    })
    .returning();
  serviceId = srv.id;

  // 6. Pigments
  const [p1] = await db
    .insert(s.pigments)
    .values({
      studioId,
      brand: "Swiss Color",
      name: "Dark Brown",
      code: "SC-101",
      color: "Brown",
      temperature: "neutral",
      baseType: "yellow",
      compositionType: "hybrid",
      isActive: true,
    })
    .returning();
  pigment1Id = p1.id;

  const [p2] = await db
    .insert(s.pigments)
    .values({
      studioId,
      brand: "Swiss Color",
      name: "Warm Modifier",
      code: "SC-901",
      color: "Orange/Warm",
      temperature: "warm",
      baseType: "orange",
      compositionType: "hybrid",
      isActive: true,
    })
    .returning();
  pigment2Id = p2.id;

  // 7. Consent Template
  const [tmpl] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `tmpl-${randomUUID()}`,
      name: "Standard Brows Consent",
      createdById: ownerUserId,
    })
    .returning();

  const [tmplVer] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: tmpl.id,
      versionNumber: 1,
      title: "PMU Standard Terms",
      body: "Client agrees to the PMU procedure terms.",
      contentHash: "a".repeat(64),
      publishedAt: new Date(),
      createdById: ownerUserId,
    })
    .returning();
  consentTemplateVersionId = tmplVer.id;

  // 8. Clean Medical Profile & Revision
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
      signedPdfSha256: "b".repeat(64),
      signatureMethod: "draw_on_screen",
      signaturePayload: { signature: "base64..." },
      signatoryName: "Elena Petrova",
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
      reason: "Медицинских противопоказаний нет",
      decidedById: ownerUserId,
    })
    .returning();
  return clr;
}

describe("Procedure Execution Subsystem", () => {
  it("rejects starting a procedure if medical eligibility is not cleared", async () => {
    // Client with medical risk
    const [riskyClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Risky",
        fullName: "Risky Client",
        phone: "+39000000099",
        clientStatus: "new_lead",
      })
      .returning();

    await db.insert(s.clientMedicalProfiles).values({
      clientId: riskyClient.id,
      allergies: "Severe allergy",
      contraindications: "Diabetes",
    });

    await db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: riskyClient.id,
      revisionNumber: 1,
      snapshot: {
        allergies: "Severe allergy",
        contraindications: "Diabetes",
        diabetes: true,
        keloidRisk: true,
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

    // Cycle in procedure_confirmed stage
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: riskyClient.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: masterId,
      })
      .returning();

    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id }
      )
    ).rejects.toThrow(/медицинский допуск не получен/i);
  });

  it("rejects starting a procedure if signed consent is missing or not covered for zone", async () => {
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

    await createMedicalClearance(cycle.id);

    // Consent is not signed for this cycle
    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id }
      )
    ).rejects.toThrow(/отсутствует действующее подписанное согласие/i);
  });

  it("starts a procedure successfully when medical eligibility and consent are valid", async () => {
    // 1. Setup cycle
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

    // 2. Setup clearance & signed consent covering 'brows'
    await createMedicalClearance(cycle.id);
    await createSignedConsent(cycle.id, "brows");

    // 3. Setup appointment
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 120 * 60 * 1000);
    const [appointment] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId,
        serviceId,
        startAt,
        endAt,
        status: "confirmed",
        source: "phone",
        createdById: ownerUserId,
        serviceSnapshot: { name: "Brows Powder Effect", priceCents: 25000 },
        clientSnapshot: { fullName: "Elena Petrova", phone: "+39000000005" },
        masterSnapshot: { displayName: "Master Anna" },
        priceSnapshotCents: 25000,
        durationSnapshotMinutes: 120,
      })
      .returning();

    // 4. Start Procedure
    const session = await startProcedureSession(
      { studioId, userId: ownerUserId },
      {
        cycleId: cycle.id,
        appointmentId: appointment.id,
        notes: "Начали процедуру без осложнений",
      }
    );

    expect(session).toBeDefined();
    expect(session.status).toBe("IN_PROGRESS");
    expect(session.cycleId).toBe(cycle.id);
    expect(session.appointmentId).toBe(appointment.id);
    expect(session.startedAt).toBeDefined();

    // 5. Verify audit log
    const auditLogs = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.studioId, studioId),
          eq(s.auditLogs.action, "procedure_started"),
          eq(s.auditLogs.entityId, session.id)
        )
      );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].entityType).toBe("procedure_session");

    // 6. Prevent duplicate active procedure on the same cycle
    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: cycle.id }
      )
    ).rejects.toThrow(/уже выполняется/i);
  });

  it("completes a procedure session with pigments, advances cycle stage, and completes appointment", async () => {
    // 1. Create fresh cycle in procedure_confirmed
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

    // 2. Setup clearance & signed consent
    await createMedicalClearance(cycle.id);
    await createSignedConsent(cycle.id, "brows");

    // 3. Appointment
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 120 * 60 * 1000);
    const [appointment] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId,
        serviceId,
        startAt,
        endAt,
        status: "confirmed",
        source: "instagram",
        createdById: ownerUserId,
        serviceSnapshot: { name: "Brows Powder Effect", priceCents: 25000 },
        clientSnapshot: { fullName: "Elena Petrova", phone: "+39000000005" },
        masterSnapshot: { displayName: "Master Anna" },
        priceSnapshotCents: 25000,
        durationSnapshotMinutes: 120,
      })
      .returning();

    // 4. Start Procedure
    const session = await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: cycle.id, appointmentId: appointment.id }
    );
    expect(session.status).toBe("IN_PROGRESS");

    // 5. Complete Procedure with pigments and equipment evidence
    const completed = await completeProcedureSession(
      { studioId, userId: ownerUserId },
      {
        procedureSessionId: session.id,
        healingStage: "fresh",
        anesthesia: "Sustaine Blue 4%",
        cartridge: "Kwadron 0.25 1RLLT",
        needle: "1R 0.25",
        voltage: "6.5V",
        machine: "Mast Tour Pro",
        skinReaction: "Легкое покраснение, без отека",
        painLevel: 2,
        notes: "Процедура прошла отлично, пигмент лег равноме��но",
        recommendations: "Сухой уход 3 дня, хлоргексидин при лимфе",
        nextStep: "book_second_session",
        pigments: [
          {
            pigmentId: pigment1Id,
            mixRatio: "80%",
            drops: 8,
            notes: "Основной оттенок",
          },
          {
            pigmentId: pigment2Id,
            mixRatio: "20%",
            drops: 2,
            notes: "Теплый корректор",
          },
        ],
      }
    );

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeDefined();
    expect(completed.painLevel).toBe(2);
    expect(completed.cartridge).toBe("Kwadron 0.25 1RLLT");

    // 6. Verify Cycle stage transition to first_session_completed
    const [updatedCycle] = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, cycle.id));
    expect(updatedCycle.stage).toBe("first_session_completed");
    expect(updatedCycle.firstSessionAt).toBeDefined();

    // 7. Verify Appointment status is completed
    const [updatedAppointment] = await db
      .select()
      .from(s.appointments)
      .where(eq(s.appointments.id, appointment.id));
    expect(updatedAppointment.status).toBe("completed");

    // 8. Verify Pigments recorded
    const pigmentsRecorded = await db
      .select()
      .from(s.procedurePigments)
      .where(eq(s.procedurePigments.procedureSessionId, session.id));
    expect(pigmentsRecorded.length).toBe(2);
    expect((pigmentsRecorded[0].pigmentSnapshot as any).brand).toBe("Swiss Color");

    // 9. Verify Queries and access logging
    const fetched = await getProcedureSession(session.id);
    expect(fetched.id).toBe(session.id);
    expect(fetched.pigments.length).toBe(2);
    expect(fetched.master?.displayName).toBe("Master Anna");

    const history = await getCycleProcedureHistory(cycle.id);
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("COMPLETED");

    const clientHistory = await getClientProcedureHistory(clientId);
    expect(clientHistory.length).toBeGreaterThanOrEqual(1);

    const updatedEv = await updateProcedureEvidence(
      { studioId, userId: ownerUserId },
      { procedureSessionId: session.id, notes: "Дополнительные примечания по заживлению" }
    );
    expect(updatedEv.notes).toBe("Дополнительные примечания по заживлению");
  });

  it("aborts an in-progress procedure session and records reason without invalid cycle stage progression", async () => {
    // 1. Setup cycle & consent
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

    await createMedicalClearance(cycle.id);
    await createSignedConsent(cycle.id, "brows");

    // 2. Start Procedure
    const session = await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: cycle.id }
    );
    expect(session.status).toBe("IN_PROGRESS");

    // 3. Abort Procedure
    const aborted = await abortProcedureSession(
      { studioId, userId: ownerUserId },
      {
        procedureSessionId: session.id,
        reason: "Клиент почувствовал головокружение, процедура остановлена",
      }
    );

    expect(aborted.status).toBe("ABORTED");
    expect(aborted.abortReason).toBe("Клиент почувствовал головокружение, процедура остановлена");
    expect(aborted.abortedAt).toBeDefined();

    // 4. Verify Cycle remains at procedure_confirmed without advancing
    const [cycleAfterAbort] = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, cycle.id));
    expect(cycleAfterAbort.stage).toBe("procedure_confirmed");

    // 5. Verify audit log
    const auditLogs = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.studioId, studioId),
          eq(s.auditLogs.action, "procedure_aborted"),
          eq(s.auditLogs.entityId, session.id)
        )
      );
    expect(auditLogs.length).toBe(1);
  });
});
