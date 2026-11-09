import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { GENERIC_ALLOWED_EDGES } from "@/features/treatment-cycles/stages";

const session = vi.hoisted(() => ({ id: "", studioId: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "pmu_active_studio" && session.studioId ? { value: session.studioId } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let cycleActions: typeof import("@/features/treatment-cycles/server/actions");
let consultationActions: typeof import("@/features/consultations/server/results");
let reviewActions: typeof import("@/features/treatment-cycles/server/review");

let studioId: string, foreignStudioId: string, clientId: string, masterId: string, roleIds: Record<string, string>;
const actor = randomUUID();

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;
  cycleActions = await import("@/features/treatment-cycles/server/actions");
  consultationActions = await import("@/features/consultations/server/results");
  reviewActions = await import("@/features/treatment-cycles/server/review");

  await db.insert(s.user).values({
    id: actor,
    name: "Test Operator",
    email: `operator-${actor}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  roleIds = Object.fromEntries((await db.select().from(s.roles)).map((r) => [r.code, r.id]));
});

beforeEach(async () => {
  session.id = actor;
  const [studioA, studioB] = await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning();
  studioId = studioA.id;
  foreignStudioId = studioB.id;
  session.studioId = studioId;

  await db.insert(s.studioMembers).values({ userId: actor, studioId, roleId: roleIds.OWNER, isActive: true });

  const [master] = await db.insert(s.masters).values({ studioId, userId: actor, displayName: "Master Tester", isActive: true }).returning();
  masterId = master.id;

  const [client] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(studioId),
      assignedMasterId: masterId,
      language: "it",
      clientKind: "new",
      reportedPreviousPmu: false,
      interestedZones: ["brows", "eyes", "lips"],
    })
    .returning();
  clientId = client.id;
});

afterEach(async () => {
  await db.delete(s.studios).where(eq(s.studios.id, studioId));
  await db.delete(s.studios).where(eq(s.studios.id, foreignStudioId));
});

afterAll(async () => {
  try {
    await db.delete(s.user).where(eq(s.user.id, actor));
  } finally {
    if (database) await database.close();
  }
});

async function counts() {
  return Promise.all([
    db.select({ id: s.cycleStageHistory.id }).from(s.cycleStageHistory).where(eq(s.cycleStageHistory.studioId, studioId)).then((r) => r.length),
    db.select({ id: s.auditLogs.id }).from(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)).then((r) => r.length),
    db.select({ id: s.outboxJobs.id }).from(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioId)).then((r) => r.length),
  ]);
}

test("Generic whitelist defines exactly two allowed edges", () => {
  expect(GENERIC_ALLOWED_EDGES.size).toBe(2);
  expect(GENERIC_ALLOWED_EDGES.has("new_lead->qualification")).toBe(true);
  expect(GENERIC_ALLOWED_EDGES.has("consultation_needed->consultation_offered")).toBe(true);
});

test("Section 8: qualification ownership - generic qualification->consultation_needed is rejected, qualifyCycleAction succeeds", async () => {
  const created = await cycleActions.createCycleAction({ clientId, zoneCode: "brows", reason: "Create cycle" }, randomUUID());
  await cycleActions.transitionCycleAction({ id: created.id, expectedVersion: 1, to: "qualification", reason: "Advance to qualification" }, randomUUID());

  const beforeCounts = await counts();

  // Generic transition attempt MUST be rejected
  await expect(
    cycleActions.transitionCycleAction(
      { id: created.id, expectedVersion: 2, to: "consultation_needed", reason: "Try generic bypass" },
      randomUUID()
    )
  ).rejects.toThrow("Требуется квалификация специалистом");

  // Zero side effects created on failure
  expect(await counts()).toEqual(beforeCounts);

  // Specialized command MUST succeed
  const qualResult = await consultationActions.qualifyCycleAction(
    {
      id: created.id,
      expectedVersion: 2,
      otherMasterPmu: false,
      doubt: false,
      conditionChanged: false,
      evaluationRequired: true,
      reason: "Clinical assessment requires consultation",
    },
    randomUUID()
  );

  expect(qualResult.version).toBe(3);

  // Evidence record inserted
  const qualRecords = await db.select().from(s.cycleQualifications).where(eq(s.cycleQualifications.cycleId, created.id));
  expect(qualRecords).toHaveLength(1);
  expect(qualRecords[0].consultationRequired).toBe(true);

  // Stage history written exactly once for transition
  const histories = await db.select().from(s.cycleStageHistory).where(eq(s.cycleStageHistory.cycleId, created.id)).orderBy(s.cycleStageHistory.version);
  expect(histories).toHaveLength(3); // created (v1), qualification (v2), consultation_needed (v3)
  expect(histories[2]).toMatchObject({
    fromStage: "qualification",
    toStage: "consultation_needed",
    version: 3,
  });
});

test("Section 9: lost ownership - generic transitions to lost are blocked from all stages, reviewCycleAction owns lost", async () => {
  const c1 = await cycleActions.createCycleAction({ clientId, zoneCode: "brows", reason: "Create c1" }, randomUUID());
  const beforeCounts = await counts();

  // 1. new_lead -> lost rejected
  await expect(
    cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 1, to: "lost", reason: "Try generic lost" }, randomUUID())
  ).rejects.toThrow("Требуется закрытие через оценку специалиста");
  expect(await counts()).toEqual(beforeCounts);

  // Advance to qualification
  await cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 1, to: "qualification", reason: "To qual" }, randomUUID());

  // 2. qualification -> lost rejected
  await expect(
    cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 2, to: "lost", reason: "Try generic lost" }, randomUUID())
  ).rejects.toThrow("Требуется закрытие через оценку специалиста");

  // Advance to consultation_needed via qualify
  await consultationActions.qualifyCycleAction(
    { id: c1.id, expectedVersion: 2, otherMasterPmu: false, doubt: false, conditionChanged: false, evaluationRequired: true, reason: "Needs consult" },
    randomUUID()
  );

  // 3. consultation_needed -> lost rejected
  await expect(
    cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 3, to: "lost", reason: "Try generic lost" }, randomUUID())
  ).rejects.toThrow("Требуется закрытие через оценку специалиста");

  // Advance to consultation_offered
  await cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 3, to: "consultation_offered", reason: "Offer consult" }, randomUUID());

  // 4. consultation_offered -> lost rejected
  await expect(
    cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 4, to: "lost", reason: "Try generic lost" }, randomUUID())
  ).rejects.toThrow("Требуется закрытие через оценку специалиста");

  // 5. reviewCycleAction with operation="lost" succeeds from allowed stage
  const reviewResult = await reviewActions.reviewCycleAction(
    {
      id: c1.id,
      expectedVersion: 4,
      operation: "lost",
      reason: "Client declined consultation offer",
      comment: "Client moving out of city",
    },
    randomUUID()
  );

  expect(reviewResult.version).toBe(5);

  const [cycleRow] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, c1.id));
  expect(cycleRow.stage).toBe("lost");

  const reviews = await db.select().from(s.cycleReviews).where(eq(s.cycleReviews.cycleId, c1.id));
  expect(reviews).toHaveLength(1);
  expect(reviews[0].operation).toBe("lost");
});

test("Section 10: generic whitelist - both approved edges advance stage atomically", async () => {
  const created = await cycleActions.createCycleAction({ clientId, zoneCode: "brows", reason: "New lead" }, randomUUID());
  const countsBefore = await counts();

  // Edge 1: new_lead -> qualification
  const t1 = await cycleActions.transitionCycleAction(
    { id: created.id, expectedVersion: 1, to: "qualification", reason: "Starting qualification" },
    randomUUID()
  );
  expect(t1.version).toBe(2);

  const countsAfterT1 = await counts();
  expect(countsAfterT1[0]).toBe(countsBefore[0] + 1); // history +1
  expect(countsAfterT1[1]).toBe(countsBefore[1] + 1); // audit +1
  expect(countsAfterT1[2]).toBe(countsBefore[2] + 1); // outbox +1

  // Advance to consultation_needed via qualify
  await consultationActions.qualifyCycleAction(
    { id: created.id, expectedVersion: 2, otherMasterPmu: false, doubt: false, conditionChanged: false, evaluationRequired: true, reason: "Needs consult" },
    randomUUID()
  );

  const countsBeforeT2 = await counts();

  // Edge 2: consultation_needed -> consultation_offered
  const t2 = await cycleActions.transitionCycleAction(
    { id: created.id, expectedVersion: 3, to: "consultation_offered", reason: "Offering consultation" },
    randomUUID()
  );
  expect(t2.version).toBe(4);

  const countsAfterT2 = await counts();
  expect(countsAfterT2[0]).toBe(countsBeforeT2[0] + 1); // history +1
  expect(countsAfterT2[1]).toBe(countsBeforeT2[1] + 1); // audit +1
  expect(countsAfterT2[2]).toBe(countsBeforeT2[2] + 1); // outbox +1

  const [finalCycle] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, created.id));
  expect(finalCycle.stage).toBe("consultation_offered");
  expect(finalCycle.version).toBe(4);
});

test("Section 11: future-command regression - generic transition rejects entry into future-owned stages", async () => {
  // 1. consultation_offered -> consultation_scheduled
  const [c1] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "consultation_offered", version: 1 }).returning();
  await expect(
    cycleActions.transitionCycleAction({ id: c1.id, expectedVersion: 1, to: "consultation_scheduled", reason: "Try schedule" }, randomUUID())
  ).rejects.toThrow("Запись на консультацию через календарь");

  // 2. qualification -> procedure_slot_selected
  const [c2] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "qualification", version: 1 }).returning();
  await expect(
    cycleActions.transitionCycleAction({ id: c2.id, expectedVersion: 1, to: "procedure_slot_selected", reason: "Try select slot" }, randomUUID())
  ).rejects.toThrow("Проверка допуска и выбор реального слота");

  // 3. procedure_slot_selected -> awaiting_acconto
  const [c3] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "procedure_slot_selected", version: 1 }).returning();
  await expect(
    cycleActions.transitionCycleAction({ id: c3.id, expectedVersion: 1, to: "awaiting_acconto", reason: "Try acconto" }, randomUUID())
  ).rejects.toThrow("Удержание слота и требование предоплаты");

  // 4. procedure_confirmed -> first_session_completed
  const [c4] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "procedure_confirmed", version: 1 }).returning();
  await expect(
    cycleActions.transitionCycleAction({ id: c4.id, expectedVersion: 1, to: "first_session_completed", reason: "Try complete session 1" }, randomUUID())
  ).rejects.toThrow("Завершение первой процедуры");

  // 5. cycle_completed -> refresh_offered
  const [c5] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "cycle_completed", version: 1 }).returning();
  await expect(
    cycleActions.transitionCycleAction({ id: c5.id, expectedVersion: 1, to: "refresh_offered", reason: "Try refresh offer" }, randomUUID())
  ).rejects.toThrow("Предложение Refresh с проверкой срока");
});

test("Section 12: lost/reopen semantics - generic reopen is rejected, reviewCycleAction(reassess) owns reopen", async () => {
  const [lostCycle] = await db.insert(s.treatmentCycles).values({ studioId, clientId, zoneCode: "brows", kind: "pmu", stage: "lost", version: 1, assignedMasterId: masterId }).returning();

  // Generic transition rejected
  await expect(
    cycleActions.transitionCycleAction({ id: lostCycle.id, expectedVersion: 1, to: "qualification", reason: "Reopen generic" }, randomUUID())
  ).rejects.toThrow("Требуется повторная оценка специалиста");

  await expect(
    cycleActions.transitionCycleAction({ id: lostCycle.id, expectedVersion: 1, to: "consultation_needed", reason: "Reopen generic" }, randomUUID())
  ).rejects.toThrow("Требуется повторная оценка специалиста");

  // Specialized review reopen succeeds
  const reopenResult = await reviewActions.reviewCycleAction(
    {
      id: lostCycle.id,
      expectedVersion: 1,
      operation: "reassess",
      otherMasterPmu: false,
      doubt: false,
      conditionChanged: false,
      evaluationRequired: false,
      reason: "Reopening client lead",
      comment: "Client called back and wants to proceed",
    },
    randomUUID()
  );

  expect(reopenResult.version).toBe(2);
  const [reopenedCycle] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, lostCycle.id));
  expect(reopenedCycle.stage).toBe("consultation_needed");
});

test("Section 13: archived, foreign studio, and stale version invariants are preserved", async () => {
  const created = await cycleActions.createCycleAction({ clientId, zoneCode: "brows", reason: "New lead" }, randomUUID());

  // 1. Stale expectedVersion rejected
  await expect(
    cycleActions.transitionCycleAction({ id: created.id, expectedVersion: 999, to: "qualification", reason: "Stale test" }, randomUUID())
  ).rejects.toThrow("Цикл изменён");

  // 2. Archived cycle rejected
  await db.update(s.treatmentCycles).set({ archivedAt: new Date() }).where(eq(s.treatmentCycles.id, created.id));
  await expect(
    cycleActions.transitionCycleAction({ id: created.id, expectedVersion: 1, to: "qualification", reason: "Archived test" }, randomUUID())
  ).rejects.toThrow("Цикл недоступен");

  // 3. Foreign studio cycle rejected
  const [foreignClient] = await db.insert(s.clients).values(clientFixture(foreignStudioId)).returning();
  const [foreignCycle] = await db.insert(s.treatmentCycles).values({ studioId: foreignStudioId, clientId: foreignClient.id, zoneCode: "brows", kind: "pmu", stage: "new_lead", version: 1 }).returning();

  await expect(
    cycleActions.transitionCycleAction({ id: foreignCycle.id, expectedVersion: 1, to: "qualification", reason: "Foreign studio test" }, randomUUID())
  ).rejects.toThrow("Цикл недоступен");
});
