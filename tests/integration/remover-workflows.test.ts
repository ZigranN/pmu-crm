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

let createRemoverCycleAction: typeof import("@/features/treatment-cycles/server/actions").createRemoverCycleAction;
let startProcedureSession: typeof import("@/features/procedures/server/service").startProcedureSession;
let completeProcedureSession: typeof import("@/features/procedures/server/service").completeProcedureSession;

let studioId: string;
let otherStudioId: string;
let ownerUserId: string;
let masterId: string;
let clientId: string;
let originalCycleId: string;
let consentTemplateVersionId: string;
let medicalRevision1Id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const cycleActions = await import("@/features/treatment-cycles/server/actions");
  createRemoverCycleAction = cycleActions.createRemoverCycleAction;

  const procService = await import("@/features/procedures/server/service");
  startProcedureSession = procService.startProcedureSession;
  completeProcedureSession = procService.completeProcedureSession;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Remover Test Studio",
        slug: `rem-studio-${randomUUID()}`,
      },
      {
        ...studioFixture(),
        name: "Other Remover Studio",
        slug: `other-rem-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const [otherSt] = await db
    .select()
    .from(s.studios)
    .where(eq(s.studios.name, "Other Remover Studio"));
  otherStudioId = otherSt.id;

  // 2. Owner User & Membership
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Remover Tester",
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
      displayName: "Master Daria",
    })
    .returning();
  masterId = m.id;

  // 4. Client
  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Tatiana",
      fullName: "Tatiana Remover",
      phone: `+39 333 ${Math.floor(1000000 + Math.random() * 9000000)}`,
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;

  // 5. Original PMU cycle
  const [orig] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "cycle_completed",
      assignedMasterId: masterId,
    })
    .returning();
  originalCycleId = orig.id;

  // 6. Service
  await db
    .insert(s.services)
    .values({
      studioId,
      name: "Remover Procedure",
      category: "brows",
      procedureType: "brows",
      priceCents: 8000,
      durationMinutes: 60,
    });

  // 7. Consent Template & Version
  const [tmpl] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `tmpl-rem-${randomUUID()}`,
      name: "Remover Consent",
      createdById: ownerUserId,
    })
    .returning();

  const [tmplVer] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: tmpl.id,
      versionNumber: 1,
      title: "Remover Consent Terms",
      body: "Client agrees to the Remover procedure terms.",
      contentHash: "c".repeat(64),
      publishedAt: new Date(),
      createdById: ownerUserId,
    })
    .returning();
  consentTemplateVersionId = tmplVer.id;

  // 8. Medical Profile & Revision
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

async function setCycleStage(cycleId: string, fromStage: string, toStage: string, version: number) {
  const cmdId = randomUUID();
  const reqKey = randomUUID();
  await db.insert(s.commandReceipts).values({
    id: cmdId,
    studioId,
    actorId: ownerUserId,
    command: "cycle.transition.v1",
    requestKey: reqKey,
    payloadHash: `hash-${randomUUID()}`,
    result: { id: cycleId, version },
  });
  await db.insert(s.cycleStageHistory).values({
    studioId,
    cycleId,
    fromStage,
    toStage,
    version,
    actorId: ownerUserId,
    commandId: cmdId,
    reason: "Test stage transition",
  });
  await db
    .update(s.treatmentCycles)
    .set({ stage: toStage, version })
    .where(eq(s.treatmentCycles.id, cycleId));
}

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
      signedPdfSha256: "d".repeat(64),
      signatureMethod: "draw_on_screen",
      signaturePayload: { signature: "base64..." },
      signatoryName: "Tatiana Remover",
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

describe("Remover Workflows Integration", () => {
  it("creates a Remover TreatmentCycle linked to an original PMU cycle", async () => {
    const reqKey = randomUUID();
    const result = (await createRemoverCycleAction(
      {
        clientId,
        zoneCode: "brows",
        originCycleId: originalCycleId,
        reason: "Удаление старого татуажа ремувером",
      },
      reqKey
    )) as any;

    expect(result.id).toBeDefined();

    const [cycle] = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, result.id));

    expect(cycle).toBeDefined();
    expect(cycle.kind).toBe("remover");
    expect(cycle.zoneCode).toBe("brows");
    expect(cycle.originCycleId).toBe(originalCycleId);
    expect(cycle.stage).toBe("new_lead");

    // Verify audit log
    const [auditLog] = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.entityId, result.id),
          eq(s.auditLogs.action, "remover_cycle_created")
        )
      );

    expect(auditLog).toBeDefined();
    expect(auditLog.entityType).toBe("treatment_cycle");
  });

  it("is idempotent: repeated execution with the same requestKey returns identical result", async () => {
    const reqKey = randomUUID();
    const first = (await createRemoverCycleAction(
      {
        clientId,
        zoneCode: "lips",
        reason: "Удаление на губах",
      },
      reqKey
    )) as any;

    const second = (await createRemoverCycleAction(
      {
        clientId,
        zoneCode: "lips",
        reason: "Удаление на губах",
      },
      reqKey
    )) as any;

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(first.version);
  });

  it("rejects invalid cross-studio origin cycle", async () => {
    // Create client & cycle in another studio
    const [foreignClient] = await db
      .insert(s.clients)
      .values({
        studioId: otherStudioId,
        firstName: "Foreign",
        fullName: "Foreign Client",
        phone: `+39 333 ${Math.floor(1000000 + Math.random() * 9000000)}`,
        clientStatus: "new_lead",
      })
      .returning();

    const [foreignCycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId: otherStudioId,
        clientId: foreignClient.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "new_lead",
      })
      .returning();

    await expect(
      createRemoverCycleAction(
        {
          clientId,
          zoneCode: "brows",
          originCycleId: foreignCycle.id,
          reason: "Cross studio origin cycle attempt",
        },
        randomUUID()
      )
    ).rejects.toThrow(/Исходный цикл не найден/);
  });

  it("enforces medical and consent guards on Remover procedure execution", async () => {
    const reqKey = randomUUID();
    const { id: removerCycleId } = (await createRemoverCycleAction(
      {
        clientId,
        zoneCode: "brows",
        reason: "Тест мед. и consent гардов",
      },
      reqKey
    )) as any;

    // Set assignedMasterId on remover cycle and transition to procedure_confirmed
    await db
      .update(s.treatmentCycles)
      .set({ assignedMasterId: masterId })
      .where(eq(s.treatmentCycles.id, removerCycleId));

    await setCycleStage(removerCycleId, "new_lead", "procedure_confirmed", 2);

    // Procedure execution fails without medical clearance and signed consent
    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: removerCycleId, masterId }
      )
    ).rejects.toThrow(/медицинский допуск не получен/i);

    // Provide medical clearance
    await createMedicalClearance(removerCycleId);

    // Still fails without consent
    await expect(
      startProcedureSession(
        { studioId, userId: ownerUserId },
        { cycleId: removerCycleId, masterId }
      )
    ).rejects.toThrow(/согласие/i);

    // Provide signed consent
    await createSignedConsent(removerCycleId, "brows");

    // Now procedure start succeeds
    const startProcRes = (await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: removerCycleId, masterId }
    )) as any;

    expect(startProcRes.id).toBeDefined();
    expect(startProcRes.status).toBe("IN_PROGRESS");

    // Complete session 1
    const completeProcRes = (await completeProcedureSession(
      { studioId, userId: ownerUserId },
      {
        procedureSessionId: startProcRes.id,
        notes: "Успешное выполнение сессии ремувера",
        pigments: [],
      }
    )) as any;

    expect(completeProcRes.status).toBe("COMPLETED");

    // Multiple sessions under same cycle: cycle moves to in_treatment or follow_up, then can run another procedure session
    await setCycleStage(removerCycleId, "first_session_completed", "procedure_confirmed", 4);

    const session2 = (await startProcedureSession(
      { studioId, userId: ownerUserId },
      { cycleId: removerCycleId, masterId }
    )) as any;

    expect(session2.id).toBeDefined();
    expect(session2.id).not.toBe(startProcRes.id);
  });
});
