import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  createMedicalProfileRevision,
  normalizeMedicalProfileSnapshot,
  type MedicalProfileRevision,
} from "@/features/medical/server/revisions";
import * as auditService from "@/server/services/audit-log.service";

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
let clearanceModule: typeof import("@/features/medical/server/clearance");

type AppDb = typeof import("@/db").db;
const appDb = () => database.db as unknown as AppDb;

let studioId: string;
let foreignStudioId: string;

let ownerUserId: string;
let masterUserId: string;
let adminUserId: string;

let masterRecordId: string;
let foreignMasterRecordId: string;

let roles: Record<string, string>;

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  vi.doMock("@/db", () => ({ db }));
  clearanceModule = await import("@/features/medical/server/clearance");

  // Create studios
  const [st1, st2] = await db
    .insert(s.studios)
    .values([studioFixture(), studioFixture()])
    .returning();
  studioId = st1.id;
  foreignStudioId = st2.id;

  // Create users
  ownerUserId = `user-owner-${randomUUID()}`;
  masterUserId = `user-master-${randomUUID()}`;
  adminUserId = `user-admin-${randomUUID()}`;

  for (const [uId, uName] of [
    [ownerUserId, "Owner Actor"],
    [masterUserId, "Master Actor"],
    [adminUserId, "Admin Actor"],
  ]) {
    await db.insert(s.user).values({
      id: uId,
      name: uName,
      email: `${uId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Fetch roles
  roles = Object.fromEntries(
    (await db.select().from(s.roles)).map((r) => [r.code, r.id])
  );

  // Assign studio memberships
  await db.insert(s.studioMembers).values([
    { studioId, userId: ownerUserId, roleId: roles.OWNER },
    { studioId, userId: masterUserId, roleId: roles.MASTER },
    { studioId, userId: adminUserId, roleId: roles.ADMIN },
  ]);

  // Create masters in studio
  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: masterUserId,
      displayName: "Master Specialist",
    })
    .returning();
  masterRecordId = m1.id;

  const [m2] = await db
    .insert(s.masters)
    .values({
      studioId: foreignStudioId,
      displayName: "Foreign Master",
    })
    .returning();
  foreignMasterRecordId = m2.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

afterAll(async () => {
  await database.close();
});

async function createClientAndCycle(opts?: {
  targetStudioId?: string;
  assignedMasterId?: string | null;
}) {
  const db = appDb();
  const stId = opts?.targetStudioId ?? studioId;
  const masterId =
    opts?.assignedMasterId !== undefined ? opts.assignedMasterId : masterRecordId;

  const [client] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(stId),
      assignedMasterId: masterId,
    })
    .returning();

  const [cycle] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId: stId,
      clientId: client.id,
      zoneCode: "brows",
      kind: "pmu",
      assignedMasterId: masterId,
      stage: "new_lead",
      version: 1,
    })
    .returning();

  let revision: MedicalProfileRevision;
  await db.transaction(async (tx) => {
    revision = await createMedicalProfileRevision(tx, {
      studioId: stId,
      clientId: client.id,
      snapshot: normalizeMedicalProfileSnapshot({
        allergies: "None",
        contraindications: "None",
        skinType: "Fitzpatrick II",
      }),
      createdById: ownerUserId,
    });
  });

  return { client, cycle, revision: revision! };
}

test("1. OWNER records decision successfully", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  const result = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Patient is fit for brows PMU procedure",
      clinicalNotes: "Normal skin response",
    },
    key
  );

  expect(result.id).toBeDefined();
  expect(result.cycleId).toBe(cycle.id);
  expect(result.medicalRevisionId).toBe(revision.id);
  expect(result.decisionNumber).toBe(1);
  expect(result.decision).toBe("CLEARED");

  const [clearance] = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.id, result.id));

  expect(clearance).toBeDefined();
  expect(clearance.studioId).toBe(studioId);
  expect(clearance.cycleId).toBe(cycle.id);
  expect(clearance.medicalRevisionId).toBe(revision.id);
  expect(clearance.decisionNumber).toBe(1);
  expect(clearance.decision).toBe("CLEARED");
  expect(clearance.reason).toBe("Patient is fit for brows PMU procedure");
  expect(clearance.clinicalNotes).toBe("Normal skin response");
  expect(clearance.decidedById).toBe(ownerUserId);
});

test("2. Scoped MASTER records decision successfully", async () => {
  const { cycle, revision } = await createClientAndCycle({
    assignedMasterId: masterRecordId,
  });
  session.id = masterUserId;
  session.studioId = studioId;

  const key = randomUUID();
  const result = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Specialist consultation needed due to history",
      clinicalNotes: "Follow-up test recommended",
    },
    key
  );

  expect(result.id).toBeDefined();
  expect(result.decisionNumber).toBe(1);
  expect(result.decision).toBe("CONSULTATION_REQUIRED");

  const [clearance] = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.id, result.id));

  expect(clearance.decidedById).toBe(masterUserId);
});

test("3. ADMIN attempts decision is rejected with Permission denied", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = adminUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Admin trying to clear",
      },
      key
    )
  ).rejects.toThrow(/Permission denied|FORBIDDEN_PERMISSION/);
});

test("4. Cross-Studio cycle is rejected", async () => {
  const { cycle, revision } = await createClientAndCycle({
    targetStudioId: foreignStudioId,
    assignedMasterId: foreignMasterRecordId,
  });

  // Attempting to record decision while authenticated in studioId
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Cross studio attempt",
      },
      key
    )
  ).rejects.toThrow();
});

test("5. Revision from different client is rejected", async () => {
  const { cycle } = await createClientAndCycle();
  const { revision: otherClientRevision } = await createClientAndCycle();

  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: otherClientRevision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Mismatched client revision",
      },
      key
    )
  ).rejects.toThrow("Медицинская ревизия не принадлежит клиенту цикла");
});

test("6. Revision from different Studio is rejected", async () => {
  const { cycle } = await createClientAndCycle({ targetStudioId: studioId });
  const { revision: foreignRevision } = await createClientAndCycle({
    targetStudioId: foreignStudioId,
    assignedMasterId: foreignMasterRecordId,
  });

  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: foreignRevision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Foreign studio revision",
      },
      key
    )
  ).rejects.toThrow();
});

test("7. Missing revision is rejected", async () => {
  const { cycle } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: randomUUID(),
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Missing revision ID",
      },
      key
    )
  ).rejects.toThrow("Медицинская ревизия не найдена");
});

test("8. Superseded revision for new decision is rejected", async () => {
  const { client, cycle, revision: revision1 } = await createClientAndCycle();

  // Create revision 2 for client
  let revision2: MedicalProfileRevision;
  await appDb().transaction(async (tx) => {
    revision2 = await createMedicalProfileRevision(tx, {
      studioId,
      clientId: client.id,
      snapshot: normalizeMedicalProfileSnapshot({
        allergies: "Nickel",
        contraindications: "None",
        skinType: "Fitzpatrick II",
      }),
      createdById: ownerUserId,
    });
  });

  expect(revision2!.revisionNumber).toBe(2);

  session.id = ownerUserId;
  session.studioId = studioId;

  // Attempting to record a NEW clearance using superseded revision 1
  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision1.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Attempt with old revision",
      },
      key
    )
  ).rejects.toThrow("Медицинские данные были обновлены. Проверьте актуальную ревизию профиля.");

  // Using current revision 2 succeeds
  const validKey = randomUUID();
  const res = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision2!.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Attempt with latest revision",
    },
    validKey
  );
  expect(res.decisionNumber).toBe(1);
});

test("9. Stale cycle version is rejected", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 999, // mismatch
        decision: "CLEARED",
        reason: "Wrong version attempt",
      },
      key
    )
  ).rejects.toThrow("Цикл изменен. Обновите страницу перед следующим действием");
});

test("10. Re-review semantics: consultation_required -> cleared on same revision produces two immutable rows", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key1 = randomUUID();
  const res1 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Initial evaluation requires doctor consultation",
    },
    key1
  );

  expect(res1.decisionNumber).toBe(1);
  expect(res1.decision).toBe("CONSULTATION_REQUIRED");

  const key2 = randomUUID();
  const res2 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Doctor consultation completed with approval",
    },
    key2
  );

  expect(res2.decisionNumber).toBe(2);
  expect(res2.decision).toBe("CLEARED");

  const list = await clearanceModule.getCycleMedicalClearances(studioId, cycle.id, appDb());
  expect(list).toHaveLength(2);
  expect(list.map((c) => ({ num: c.decisionNumber, dec: c.decision }))).toEqual([
    { num: 1, dec: "CONSULTATION_REQUIRED" },
    { num: 2, dec: "CLEARED" },
  ]);

  const latest = await clearanceModule.getLatestCycleMedicalClearance(studioId, cycle.id, appDb());
  expect(latest?.decisionNumber).toBe(2);
  expect(latest?.decision).toBe("CLEARED");
});

test("11. Same requestKey replay returns original result without creating extra rows", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  const payload = {
    cycleId: cycle.id,
    medicalRevisionId: revision.id,
    expectedCycleVersion: 1,
    decision: "CLEARED" as const,
    reason: "First clearance",
  };

  const initial = await clearanceModule.recordMedicalClearanceAction(payload, key);
  const replayed = await clearanceModule.recordMedicalClearanceAction(payload, key);

  expect(replayed).toEqual(initial);

  const clearances = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycle.id));
  expect(clearances).toHaveLength(1);

  const audits = await appDb()
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, initial.id));
  expect(audits).toHaveLength(1);
});

test("12. Same requestKey with changed payload is rejected", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Initial reason",
    },
    key
  );

  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "NOT_CLEARED",
        reason: "Different reason and decision",
      },
      key
    )
  ).rejects.toThrow("Ключ запроса уже использован с другими данными");
});

test("13. Concurrent same-cycle commands allocate unique decision numbers", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const results = await Promise.all([
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "CONSULTATION_REQUIRED",
        reason: "Concurrent decision A",
      },
      randomUUID()
    ),
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Concurrent decision B",
      },
      randomUUID()
    ),
  ]);

  expect(results).toHaveLength(2);
  const decisionNumbers = results.map((r) => r.decisionNumber).sort();
  expect(decisionNumbers).toEqual([1, 2]);

  const allClearances = await clearanceModule.getCycleMedicalClearances(
    studioId,
    cycle.id,
    appDb()
  );
  expect(allClearances).toHaveLength(2);
  expect(allClearances.map((c) => c.decisionNumber)).toEqual([1, 2]);
});

test("14. Audit write failure causes complete atomic rollback", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const clearancesCountBefore = (await appDb().select().from(s.cycleMedicalClearances)).length;
  const receiptsCountBefore = (await appDb().select().from(s.commandReceipts)).length;

  const spy = vi.spyOn(auditService, "writeAudit").mockRejectedValueOnce(new Error("Audit database failure"));

  const key = randomUUID();
  await expect(
    clearanceModule.recordMedicalClearanceAction(
      {
        cycleId: cycle.id,
        medicalRevisionId: revision.id,
        expectedCycleVersion: 1,
        decision: "CLEARED",
        reason: "Failing audit test",
      },
      key
    )
  ).rejects.toThrow("Audit database failure");

  spy.mockRestore();

  const clearancesCountAfter = (await appDb().select().from(s.cycleMedicalClearances)).length;
  const receiptsCountAfter = (await appDb().select().from(s.commandReceipts)).length;

  expect(clearancesCountAfter).toBe(clearancesCountBefore);
  expect(receiptsCountAfter).toBe(receiptsCountBefore);

  const cycleClearances = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycle.id));
  expect(cycleClearances).toHaveLength(0);
});

test("15. Audit action/entity uses dedicated correct mapping", async () => {
  const { client, cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const key = randomUUID();
  const res = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Patient has no contraindications",
    },
    key
  );

  const [audit] = await appDb()
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, res.id));

  expect(audit).toBeDefined();
  expect(audit.action).toBe("medical_clearance_recorded");
  expect(audit.entityType).toBe("cycle_medical_clearance");
  expect(audit.entityId).toBe(res.id);
  expect(audit.studioId).toBe(studioId);
  expect(audit.userId).toBe(ownerUserId);
  expect(audit.reason).toBe("Patient has no contraindications");
  expect(audit.reasonSource).toBe("user");

  const meta = audit.metadata as Record<string, unknown>;
  expect(meta.cycleId).toBe(cycle.id);
  expect(meta.clientId).toBe(client.id);
  expect(meta.medicalRevisionId).toBe(revision.id);
  expect(meta.decisionNumber).toBe(1);
  expect(meta.decision).toBe("CLEARED");
});

test("16. Decision recording leaves cycle stage, version, and unrelated tables unchanged", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const beforeCycle = (
    await appDb()
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, cycle.id))
  )[0];

  const key = randomUUID();
  await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Invariance verification",
    },
    key
  );

  const afterCycle = (
    await appDb()
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, cycle.id))
  )[0];

  expect(afterCycle.stage).toBe(beforeCycle.stage);
  expect(afterCycle.version).toBe(beforeCycle.version);
  expect(afterCycle.updatedAt).toEqual(beforeCycle.updatedAt);

  // Verify zero activity events and zero outbox jobs
  const activities = await appDb()
    .select()
    .from(s.activityEvents)
    .where(eq(s.activityEvents.studioId, studioId));
  expect(activities).toHaveLength(0);

  const outbox = await appDb()
    .select()
    .from(s.outboxJobs)
    .where(eq(s.outboxJobs.studioId, studioId));
  expect(outbox).toHaveLength(0);

  const stageHistory = await appDb()
    .select()
    .from(s.cycleStageHistory)
    .where(eq(s.cycleStageHistory.cycleId, cycle.id));
  expect(stageHistory).toHaveLength(0);
});

test("17. Read helpers enforce studioId isolation", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const res = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Tenant isolation test",
    },
    randomUUID()
  );

  // Own studio gets data
  const ownList = await clearanceModule.getCycleMedicalClearances(studioId, cycle.id, appDb());
  expect(ownList).toHaveLength(1);
  expect(ownList[0].id).toBe(res.id);

  const ownLatest = await clearanceModule.getLatestCycleMedicalClearance(studioId, cycle.id, appDb());
  expect(ownLatest?.id).toBe(res.id);

  const ownById = await clearanceModule.getMedicalClearanceById(studioId, res.id, appDb());
  expect(ownById?.id).toBe(res.id);

  // Foreign studio queries return empty/undefined
  const foreignList = await clearanceModule.getCycleMedicalClearances(foreignStudioId, cycle.id, appDb());
  expect(foreignList).toEqual([]);

  const foreignLatest = await clearanceModule.getLatestCycleMedicalClearance(foreignStudioId, cycle.id, appDb());
  expect(foreignLatest).toBeUndefined();

  const foreignById = await clearanceModule.getMedicalClearanceById(foreignStudioId, res.id, appDb());
  expect(foreignById).toBeUndefined();
});

test("18. Data is readable through fresh DB executor on PostgreSQL", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const res = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Persistence check",
    },
    randomUUID()
  );

  if (database.backend === "postgresql") {
    const fresh = await createTestDatabase();
    try {
      const readBack = await clearanceModule.getMedicalClearanceById(
        studioId,
        res.id,
        fresh.db as unknown as AppDb
      );
      expect(readBack).toBeDefined();
      expect(readBack?.id).toBe(res.id);
      expect(readBack?.decision).toBe("CLEARED");
      expect(readBack?.decisionNumber).toBe(1);
    } finally {
      await fresh.close();
    }
  } else {
    const raw = await database.db.execute(
      sql`select id, decision, decision_number from cycle_medical_clearances where id = ${res.id}`
    );
    const rows = (Array.isArray(raw) ? raw : (raw as unknown as { rows: unknown[] }).rows) as {
      id: string;
      decision: string;
      decision_number: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.id);
    expect(rows[0].decision).toBe("CLEARED");
    expect(rows[0].decision_number).toBe(1);
  }
});

test("19. Multi-revision history on same cycle sequences decisionNumber per cycle", async () => {
  const { client, cycle, revision: revision1 } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  // Decision #1 on Revision 1
  const res1 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision1.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Revision 1 cleared",
    },
    randomUUID()
  );
  expect(res1.decisionNumber).toBe(1);

  // Client updates medical profile -> Revision 2
  let revision2: MedicalProfileRevision;
  await appDb().transaction(async (tx) => {
    revision2 = await createMedicalProfileRevision(tx, {
      studioId,
      clientId: client.id,
      snapshot: normalizeMedicalProfileSnapshot({
        allergies: "Henna, Latex",
        contraindications: "None",
        skinType: "Fitzpatrick II",
      }),
      createdById: ownerUserId,
    });
  });

  // Decision #2 on Revision 2
  const res2 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision2!.id,
      expectedCycleVersion: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Revision 2 requires doctor consult",
    },
    randomUUID()
  );
  expect(res2.decisionNumber).toBe(2);

  // Decision #3 on Revision 2
  const res3 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision2!.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Revision 2 consult completed",
    },
    randomUUID()
  );
  expect(res3.decisionNumber).toBe(3);

  // Verify getLatest returns #3
  const latest = await clearanceModule.getLatestCycleMedicalClearance(studioId, cycle.id, appDb());
  expect(latest?.decisionNumber).toBe(3);
  expect(latest?.medicalRevisionId).toBe(revision2!.id);
  expect(latest?.decision).toBe("CLEARED");

  // Verify history returns all 3 in ascending order
  const history = await clearanceModule.getCycleMedicalClearances(studioId, cycle.id, appDb());
  expect(history).toHaveLength(3);
  expect(history.map((c) => ({ num: c.decisionNumber, rev: c.medicalRevisionId, dec: c.decision }))).toEqual([
    { num: 1, rev: revision1.id, dec: "CLEARED" },
    { num: 2, rev: revision2!.id, dec: "CONSULTATION_REQUIRED" },
    { num: 3, rev: revision2!.id, dec: "CLEARED" },
  ]);
});

test("20. Stale revision replay succeeds after newer revision exists", async () => {
  const { client, cycle, revision: revision1 } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const replayKey = randomUUID();
  const payload1 = {
    cycleId: cycle.id,
    medicalRevisionId: revision1.id,
    expectedCycleVersion: 1,
    decision: "CLEARED" as const,
    reason: "Revision 1 decision",
  };

  const initial = await clearanceModule.recordMedicalClearanceAction(payload1, replayKey);
  expect(initial.decisionNumber).toBe(1);

  // Client creates Revision 2
  await appDb().transaction(async (tx) => {
    await createMedicalProfileRevision(tx, {
      studioId,
      clientId: client.id,
      snapshot: normalizeMedicalProfileSnapshot({
        allergies: "Aspirin",
        contraindications: "None",
        skinType: "Fitzpatrick II",
      }),
      createdById: ownerUserId,
    });
  });

  // Replay of initial command referencing R1 MUST succeed even though R2 now exists
  const replayed = await clearanceModule.recordMedicalClearanceAction(payload1, replayKey);
  expect(replayed).toEqual(initial);

  // Verify no extra rows were inserted
  const history = await clearanceModule.getCycleMedicalClearances(studioId, cycle.id, appDb());
  expect(history).toHaveLength(1);
});

test("21. Changed cycle version replay succeeds", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const replayKey = randomUUID();
  const payload = {
    cycleId: cycle.id,
    medicalRevisionId: revision.id,
    expectedCycleVersion: 1,
    decision: "CLEARED" as const,
    reason: "Initial version 1 clearance",
  };

  const initial = await clearanceModule.recordMedicalClearanceAction(payload, replayKey);
  expect(initial.id).toBeDefined();

  // Cycle version increments due to unrelated operation
  await appDb()
    .update(s.treatmentCycles)
    .set({ version: 2 })
    .where(eq(s.treatmentCycles.id, cycle.id));

  // Replaying the command with original payload (expectedCycleVersion: 1) MUST succeed
  const replayed = await clearanceModule.recordMedicalClearanceAction(payload, replayKey);
  expect(replayed).toEqual(initial);
});

test("22. Permission lost before replay is rejected", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  const replayKey = randomUUID();
  const payload = {
    cycleId: cycle.id,
    medicalRevisionId: revision.id,
    expectedCycleVersion: 1,
    decision: "CLEARED" as const,
    reason: "Decision before permission revocation",
  };

  const initial = await clearanceModule.recordMedicalClearanceAction(payload, replayKey);
  expect(initial.id).toBeDefined();

  // User changes session to an ADMIN user (who lacks MEDICAL_PROFILE_UPDATE)
  session.id = adminUserId;
  session.studioId = studioId;

  await expect(
    clearanceModule.recordMedicalClearanceAction(payload, replayKey)
  ).rejects.toThrow();
});

test("23. Re-review and replay audit cardinality", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  // 1. Initial decision
  const key1 = randomUUID();
  const res1 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Initial decision",
    },
    key1
  );

  const clearancesAfter1 = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycle.id));
  const auditsAfter1 = await appDb()
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, res1.id));
  expect(clearancesAfter1).toHaveLength(1);
  expect(auditsAfter1).toHaveLength(1);

  // 2. Replay initial decision -> 0 additional rows
  const replay1 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Initial decision",
    },
    key1
  );
  expect(replay1).toEqual(res1);

  const clearancesAfterReplay = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycle.id));
  const auditsAfterReplay = await appDb()
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, res1.id));
  expect(clearancesAfterReplay).toHaveLength(1);
  expect(auditsAfterReplay).toHaveLength(1);

  // 3. Re-review new decision -> exactly 1 new clearance row, 1 new audit row
  const key2 = randomUUID();
  const res2 = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Second decision",
    },
    key2
  );

  const clearancesAfter2 = await appDb()
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycle.id));
  const auditsAfter2 = await appDb()
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, res2.id));
  expect(clearancesAfter2).toHaveLength(2);
  expect(auditsAfter2).toHaveLength(1);
});

test("24. Merge provenance preserves clearance evidence and historical revision link", async () => {
  const { client: sourceClient, cycle: sourceCycle, revision: sourceRevision } = await createClientAndCycle();
  const { client: targetClient } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  // Record clearance on source client's cycle
  const res = await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: sourceCycle.id,
      medicalRevisionId: sourceRevision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Clearance before merge",
    },
    randomUUID()
  );

  // Perform client merge: sourceClient -> targetClient
  const mergeActions = await import("@/features/clients/server/merge-actions");
  const candidates = await mergeActions.getMergeCandidates(targetClient.id);
  expect(candidates.find((c) => c.id === sourceClient.id)).toBeDefined();

  const preview = await mergeActions.previewClientMerge({
    sourceId: sourceClient.id,
    targetId: targetClient.id,
  });
  await mergeActions.mergeClientsAction(
    {
      sourceId: sourceClient.id,
      targetId: targetClient.id,
      token: preview.token,
      reason: "Merging duplicate clients with clearances",
      choices: Object.fromEntries(
        preview.fields.filter((f) => f.conflict).map((f) => [f.field, "target"])
      ),
    },
    randomUUID()
  );

  // Verify cycle moved to targetClient
  const [cycleAfterMerge] = await appDb()
    .select()
    .from(s.treatmentCycles)
    .where(eq(s.treatmentCycles.id, sourceCycle.id));
  expect(cycleAfterMerge.clientId).toBe(targetClient.id);

  // Verify revision remains with sourceClient
  const [revisionAfterMerge] = await appDb()
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, sourceRevision.id));
  expect(revisionAfterMerge.clientId).toBe(sourceClient.id);

  // Verify clearance record still exists and references original cycleId and medicalRevisionId
  const clearanceAfterMerge = await clearanceModule.getMedicalClearanceById(studioId, res.id, appDb());
  expect(clearanceAfterMerge).toBeDefined();
  expect(clearanceAfterMerge?.cycleId).toBe(sourceCycle.id);
  expect(clearanceAfterMerge?.medicalRevisionId).toBe(sourceRevision.id);
  expect(clearanceAfterMerge?.decision).toBe("CLEARED");

  // Read helper by cycle still returns the clearance
  const cycleClearances = await clearanceModule.getCycleMedicalClearances(studioId, sourceCycle.id, appDb());
  expect(cycleClearances).toHaveLength(1);
  expect(cycleClearances[0].id).toBe(res.id);
});

test("25. Actor, Cycle, and MedicalRevision deletion restrictions enforced by database foreign keys", async () => {
  const { cycle, revision } = await createClientAndCycle();
  session.id = ownerUserId;
  session.studioId = studioId;

  await clearanceModule.recordMedicalClearanceAction(
    {
      cycleId: cycle.id,
      medicalRevisionId: revision.id,
      expectedCycleVersion: 1,
      decision: "CLEARED",
      reason: "Foreign key check",
    },
    randomUUID()
  );

  // Attempting to delete the referenced user/actor must be blocked
  await expect(
    appDb().delete(s.user).where(eq(s.user.id, ownerUserId))
  ).rejects.toThrow();

  // Attempting to delete the referenced treatmentCycle must be blocked
  await expect(
    appDb().delete(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycle.id))
  ).rejects.toThrow();

  // Attempting to delete the referenced medicalProfileRevision must be blocked
  await expect(
    appDb().delete(s.medicalProfileRevisions).where(eq(s.medicalProfileRevisions.id, revision.id))
  ).rejects.toThrow();
});
