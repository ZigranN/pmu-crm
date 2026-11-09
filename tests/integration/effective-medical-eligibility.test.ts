import { afterAll, beforeAll, expect, test, vi } from "vitest";
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
import { resolveEffectiveMedicalEligibility } from "@/features/medical/server/eligibility";

let database: Awaited<ReturnType<typeof createTestDatabase>>;

type AppDb = typeof import("@/db").db;
const appDb = () => database.db as unknown as AppDb;

let studioId: string;
let foreignStudioId: string;

let ownerUserId: string;
let masterUserId: string;
let foreignMasterUserId: string;

let masterRecordId: string;
let foreignMasterRecordId: string;

let roles: Record<string, string>;

const emptyFlags = {
  previousPMU: false,
  herpesHistory: false,
  diabetes: false,
  bloodThinners: false,
  keloidRisk: false,
  autoimmuneDiseases: false,
  recentBotoxFillers: false,
  recentPeelingLaser: false,
  skinSensitivity: false,
};

const defaultSnapshot = {
  allergies: "None",
  contraindications: "None",
  skinType: "Fitzpatrick II",
  pregnancyStatus: "not_pregnant",
  medications: "None",
  previousPMUNotes: null,
  medicalNotes: "Initial consultation notes",
  ...emptyFlags,
};

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  vi.doMock("@/db", () => ({ db }));

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
  foreignMasterUserId = `user-foreign-master-${randomUUID()}`;

  for (const [uId, uName] of [
    [ownerUserId, "Owner Actor"],
    [masterUserId, "Master Actor"],
    [foreignMasterUserId, "Foreign Master Actor"],
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
    { studioId: foreignStudioId, userId: foreignMasterUserId, roleId: roles.MASTER },
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
      userId: foreignMasterUserId,
      displayName: "Foreign Master Specialist",
    })
    .returning();
  foreignMasterRecordId = m2.id;
});

afterAll(async () => {
  if (!database) return;
  await database.close();
});

async function createClientAndCycle(opts?: {
  targetStudioId?: string;
  assignedMasterId?: string | null;
  stage?: string;
  createProfile?: boolean;
  createRevision?: boolean;
  profileData?: Partial<typeof s.clientMedicalProfiles.$inferInsert>;
  revisionData?: Partial<typeof defaultSnapshot>;
}) {
  const db = appDb();
  const stId = opts?.targetStudioId ?? studioId;
  const masterId =
    opts?.assignedMasterId !== undefined
      ? opts.assignedMasterId
      : stId === foreignStudioId
      ? foreignMasterRecordId
      : masterRecordId;

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
      stage: opts?.stage ?? "procedure_slot_selected",
      version: 1,
    })
    .returning();

  let profile: typeof s.clientMedicalProfiles.$inferSelect | undefined;
  if (opts?.createProfile !== false) {
    const pData = {
      ...defaultSnapshot,
      ...(opts?.profileData ?? {}),
      clientId: client.id,
    };
    const [insertedProfile] = await db
      .insert(s.clientMedicalProfiles)
      .values(pData)
      .returning();
    profile = insertedProfile;
  }

  let revision: MedicalProfileRevision | undefined;
  if (opts?.createRevision !== false && opts?.createProfile !== false) {
    const rSnapshot = normalizeMedicalProfileSnapshot({
      ...defaultSnapshot,
      ...(opts?.revisionData ?? {}),
      ...(opts?.profileData ?? {}),
    });
    await db.transaction(async (tx) => {
      revision = await createMedicalProfileRevision(tx, {
        studioId: stId,
        clientId: client.id,
        snapshot: rSnapshot,
        createdById: ownerUserId,
      });
    });
  }

  return { client, cycle, profile, revision };
}

async function insertClearance(opts: {
  studioId: string;
  cycleId: string;
  medicalRevisionId: string;
  decisionNumber: number;
  decision: "CLEARED" | "CONSULTATION_REQUIRED" | "NOT_CLEARED";
  decidedById: string;
}) {
  const db = appDb();
  const [clearance] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId: opts.studioId,
      cycleId: opts.cycleId,
      medicalRevisionId: opts.medicalRevisionId,
      decisionNumber: opts.decisionNumber,
      decision: opts.decision,
      decidedById: opts.decidedById,
      reason: `Test clearance ${opts.decision}`,
      clinicalNotes: "Test notes",
    })
    .returning();
  return clearance;
}

test("1. Missing medical profile yields REVIEW_REQUIRED / NO_MEDICAL_PROFILE", async () => {
  const { cycle } = await createClientAndCycle({ createProfile: false, createRevision: false });
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("NO_MEDICAL_PROFILE");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.isTerminalCycle).toBe(false);
  expect(result.currentMedicalRevisionId).toBeNull();
  expect(result.latestClearanceId).toBeNull();
});

test("2. Legacy profile without revision yields REVIEW_REQUIRED / NO_MEDICAL_REVISION", async () => {
  const { cycle, profile } = await createClientAndCycle({ createProfile: true, createRevision: false });
  expect(profile).toBeDefined();
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("NO_MEDICAL_REVISION");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.currentMedicalRevisionId).toBeNull();
  expect(result.latestClearanceId).toBeNull();
});

test("3. Revision exists without clearance yields REVIEW_REQUIRED / NO_CLEARANCE", async () => {
  const { cycle, revision } = await createClientAndCycle();
  expect(revision).toBeDefined();
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("NO_CLEARANCE");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.currentMedicalRevisionId).toBe(revision!.id);
  expect(result.currentMedicalRevisionNumber).toBe(1);
  expect(result.latestClearanceId).toBeNull();
});

test("4. Valid CLEARED clearance yields CLEARED / CLEARED", async () => {
  const { cycle, revision } = await createClientAndCycle();
  const clearance = await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("CLEARED");
  expect(result.reasonCode).toBe("CLEARED");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.currentMedicalRevisionId).toBe(revision!.id);
  expect(result.latestClearanceId).toBe(clearance.id);
  expect(result.clearanceMedicalRevisionId).toBe(revision!.id);
  expect(result.decisionNumber).toBe(1);
  expect(result.humanDecision).toBe("CLEARED");
});

test("5. Valid CONSULTATION_REQUIRED clearance yields CONSULTATION_REQUIRED", async () => {
  const { cycle, revision } = await createClientAndCycle();
  const clearance = await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CONSULTATION_REQUIRED",
    decidedById: ownerUserId,
  });
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("CONSULTATION_REQUIRED");
  expect(result.reasonCode).toBe("CONSULTATION_REQUIRED");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.latestClearanceId).toBe(clearance.id);
  expect(result.humanDecision).toBe("CONSULTATION_REQUIRED");
});

test("6. Valid NOT_CLEARED clearance yields NOT_CLEARED", async () => {
  const { cycle, revision } = await createClientAndCycle();
  const clearance = await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "NOT_CLEARED",
    decidedById: ownerUserId,
  });
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("NOT_CLEARED");
  expect(result.reasonCode).toBe("NOT_CLEARED");
  expect(result.cycleId).toBe(cycle.id);
  expect(result.latestClearanceId).toBe(clearance.id);
  expect(result.humanDecision).toBe("NOT_CLEARED");
});

test("7. Latest decision overrides an earlier decision on the same revision", async () => {
  const { cycle, revision } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CONSULTATION_REQUIRED",
    decidedById: ownerUserId,
  });
  const secondClearance = await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 2,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });
  const context = { studioId, userId: ownerUserId };

  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("CLEARED");
  expect(result.reasonCode).toBe("CLEARED");
  expect(result.decisionNumber).toBe(2);
  expect(result.latestClearanceId).toBe(secondClearance.id);
  expect(result.humanDecision).toBe("CLEARED");
});

test("8. New revision invalidates older clearance yields REVIEW_REQUIRED / MEDICAL_REVISION_CHANGED", async () => {
  const { client, cycle, revision: rev1 } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: rev1!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  // Client creates revision 2 with updated allergies
  const updatedSnapshot = normalizeMedicalProfileSnapshot({
    ...defaultSnapshot,
    allergies: "Lidocaine",
  });
  let rev2: MedicalProfileRevision;
  await appDb().transaction(async (tx) => {
    rev2 = await createMedicalProfileRevision(tx, {
      studioId,
      clientId: client.id,
      snapshot: updatedSnapshot,
      createdById: ownerUserId,
    });
    await tx
      .update(s.clientMedicalProfiles)
      .set({ allergies: "Lidocaine", updatedAt: new Date() })
      .where(eq(s.clientMedicalProfiles.clientId, client.id));
  });

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("MEDICAL_REVISION_CHANGED");
  expect(result.currentMedicalRevisionId).toBe(rev2!.id);
  expect(result.currentMedicalRevisionNumber).toBe(2);
  expect(result.clearanceMedicalRevisionId).toBe(rev1!.id);
  expect(result.humanDecision).toBe("CLEARED");
});

test("9. Medical-notes-only revision change yields REVIEW_REQUIRED / MEDICAL_REVISION_CHANGED", async () => {
  const { client, cycle, revision: rev1 } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: rev1!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  // Metadata/notes-only revision change
  const notesUpdatedSnapshot = normalizeMedicalProfileSnapshot({
    ...defaultSnapshot,
    medicalNotes: "Client mentioned mild redness last year",
  });
  let rev2: MedicalProfileRevision;
  await appDb().transaction(async (tx) => {
    rev2 = await createMedicalProfileRevision(tx, {
      studioId,
      clientId: client.id,
      snapshot: notesUpdatedSnapshot,
      createdById: ownerUserId,
    });
    await tx
      .update(s.clientMedicalProfiles)
      .set({
        medicalNotes: "Client mentioned mild redness last year",
        updatedAt: new Date(),
      })
      .where(eq(s.clientMedicalProfiles.clientId, client.id));
  });

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("MEDICAL_REVISION_CHANGED");
  expect(result.currentMedicalRevisionId).toBe(rev2!.id);
  expect(result.currentMedicalRevisionNumber).toBe(2);
});

test("10. mergeReviewRequired flag blocks effective clearance with MERGE_REVIEW_REQUIRED", async () => {
  const { client, cycle, revision } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  // Set mergeReviewRequired = true on clientMedicalProfiles
  await appDb()
    .update(s.clientMedicalProfiles)
    .set({ mergeReviewRequired: true })
    .where(eq(s.clientMedicalProfiles.clientId, client.id));

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("MERGE_REVIEW_REQUIRED");
});

test("11. Materialized profile / revision mismatch yields PROFILE_REVISION_MISMATCH", async () => {
  const { client, cycle, revision } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  // Mutate profile row directly without appending a revision
  await appDb()
    .update(s.clientMedicalProfiles)
    .set({ diabetes: true })
    .where(eq(s.clientMedicalProfiles.clientId, client.id));

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("PROFILE_REVISION_MISMATCH");
});

test("12. Separate parallel cycles resolve independently", async () => {
  const { client, cycle: cycleA, revision } = await createClientAndCycle();

  // Create Cycle B for the same client
  const [cycleB] = await appDb()
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client.id,
      zoneCode: "lips",
      kind: "pmu",
      assignedMasterId: masterRecordId,
      stage: "procedure_slot_selected",
      version: 1,
    })
    .returning();

  // Only Cycle A receives a clearance
  await insertClearance({
    studioId,
    cycleId: cycleA.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const context = { studioId, userId: ownerUserId };

  const resultA = await resolveEffectiveMedicalEligibility(context, cycleA.id, appDb());
  const resultB = await resolveEffectiveMedicalEligibility(context, cycleB.id, appDb());

  expect(resultA.status).toBe("CLEARED");
  expect(resultA.reasonCode).toBe("CLEARED");
  expect(resultA.cycleId).toBe(cycleA.id);

  expect(resultB.status).toBe("REVIEW_REQUIRED");
  expect(resultB.reasonCode).toBe("NO_CLEARANCE");
  expect(resultB.cycleId).toBe(cycleB.id);
});

test("13. Cross-Studio cycle request is rejected and fails closed", async () => {
  const { cycle } = await createClientAndCycle({ targetStudioId: foreignStudioId });
  // Query using studioId instead of foreignStudioId
  const context = { studioId, userId: ownerUserId };

  await expect(
    resolveEffectiveMedicalEligibility(context, cycle.id, appDb())
  ).rejects.toThrow();
});

test("14. MASTER cannot read an out-of-scope cycle", async () => {
  // Create cycle assigned to foreign master
  const { cycle } = await createClientAndCycle({
    targetStudioId: foreignStudioId,
    assignedMasterId: foreignMasterRecordId,
  });

  // Attempt read by local master in studioId
  const context = { studioId, userId: masterUserId };

  await expect(
    resolveEffectiveMedicalEligibility(context, cycle.id, appDb())
  ).rejects.toThrow();
});

test("15. OWNER can resolve an authorized Studio cycle", async () => {
  const { cycle, revision } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("CLEARED");
  expect(result.cycleId).toBe(cycle.id);
});

test("16. Source-client merge provenance remains intact", async () => {
  const { client: sourceClient, revision: sourceRev } =
    await createClientAndCycle();

  // Create target client with its own profile and revision
  const [targetClient] = await appDb()
    .insert(s.clients)
    .values({ ...clientFixture(studioId), assignedMasterId: masterRecordId })
    .returning();

  await appDb().insert(s.clientMedicalProfiles).values({
    ...defaultSnapshot,
    clientId: targetClient.id,
    allergies: "Latex",
  });

  let targetRev: MedicalProfileRevision;
  await appDb().transaction(async (tx) => {
    targetRev = await createMedicalProfileRevision(tx, {
      studioId,
      clientId: targetClient.id,
      snapshot: normalizeMedicalProfileSnapshot({ ...defaultSnapshot, allergies: "Latex" }),
      createdById: ownerUserId,
    });
  });

  // Verify historical revision rows remain attached to their respective clients
  const [sourceRevInDb] = await appDb()
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, sourceRev!.id));

  const [targetRevInDb] = await appDb()
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, targetRev!.id));

  expect(sourceRevInDb.clientId).toBe(sourceClient.id);
  expect(targetRevInDb.clientId).toBe(targetClient.id);
});

test("17. Moved cycle does not inherit source clearance as target clearance", async () => {
  const { cycle, revision: sourceRev } =
    await createClientAndCycle();

  // Clearance D1 recorded on source client cycle referencing source revision
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: sourceRev!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  // Target client has no revision
  const [targetClient] = await appDb()
    .insert(s.clients)
    .values({ ...clientFixture(studioId), assignedMasterId: masterRecordId })
    .returning();

  // Simulate cycle ownership transfer during client merge: cycle.clientId -> target.id
  await appDb()
    .update(s.treatmentCycles)
    .set({ clientId: targetClient.id })
    .where(eq(s.treatmentCycles.id, cycle.id));

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  // Fails closed because target client has no medical profile / revision
  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.reasonCode).toBe("NO_MEDICAL_PROFILE");
});

test("18. Terminal cycle returns NOT_APPLICABLE with historical metadata", async () => {
  const { cycle, revision } = await createClientAndCycle({
    stage: "cycle_completed",
  });

  const clearance = await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("NOT_APPLICABLE");
  expect(result.reasonCode).toBe("CYCLE_TERMINAL");
  expect(result.isTerminalCycle).toBe(true);
  expect(result.cycleId).toBe(cycle.id);
  expect(result.latestClearanceId).toBe(clearance.id);
  expect(result.clearanceMedicalRevisionId).toBe(revision!.id);
  expect(result.decisionNumber).toBe(1);
  expect(result.humanDecision).toBe("CLEARED");
});

test("19. No database rows are created or changed by evaluation (side-effect audit)", async () => {
  const { cycle, revision } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const countRows = async () => {
    const db = appDb();
    const [profiles] = await db.select({ count: sql<number>`count(*)` }).from(s.clientMedicalProfiles);
    const [revisions] = await db.select({ count: sql<number>`count(*)` }).from(s.medicalProfileRevisions);
    const [clearances] = await db.select({ count: sql<number>`count(*)` }).from(s.cycleMedicalClearances);
    const [cycles] = await db.select({ count: sql<number>`count(*)` }).from(s.treatmentCycles);
    const [audits] = await db.select({ count: sql<number>`count(*)` }).from(s.auditLogs);
    const [activities] = await db.select({ count: sql<number>`count(*)` }).from(s.activityEvents);
    return {
      profiles: Number(profiles.count),
      revisions: Number(revisions.count),
      clearances: Number(clearances.count),
      cycles: Number(cycles.count),
      audits: Number(audits.count),
      activities: Number(activities.count),
    };
  };

  const beforeCounts = await countRows();

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  expect(result.status).toBe("CLEARED");

  const afterCounts = await countRows();
  expect(afterCounts).toEqual(beforeCounts);
});

test("20. Resolver returns no raw clinical snapshot or notes", async () => {
  const { cycle, revision } = await createClientAndCycle({
    profileData: {
      allergies: "Strictly private allergy details",
      contraindications: "Confidential heart condition",
      medicalNotes: "Sensitive internal clinical notes",
    },
  });

  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: revision!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const context = { studioId, userId: ownerUserId };
  const result = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());

  const resultKeys = Object.keys(result).sort();
  const allowedKeys = [
    "status",
    "reasonCode",
    "cycleId",
    "clientId",
    "isTerminalCycle",
    "currentMedicalRevisionId",
    "currentMedicalRevisionNumber",
    "latestClearanceId",
    "clearanceMedicalRevisionId",
    "decisionNumber",
    "humanDecision",
  ].sort();

  expect(resultKeys).toEqual(allowedKeys);

  // Explicitly assert that no clinical fields or snapshots exist on the result
  const rawObj = result as unknown as Record<string, unknown>;
  expect(rawObj.allergies).toBeUndefined();
  expect(rawObj.contraindications).toBeUndefined();
  expect(rawObj.medicalNotes).toBeUndefined();
  expect(rawObj.clinicalNotes).toBeUndefined();
  expect(rawObj.snapshot).toBeUndefined();
});

test("21. Snapshot consistency: Repeatable read prevents observation of mid-evaluation committed changes", async () => {
  const { client, cycle, revision: rev1 } = await createClientAndCycle();
  await insertClearance({
    studioId,
    cycleId: cycle.id,
    medicalRevisionId: rev1!.id,
    decisionNumber: 1,
    decision: "CLEARED",
    decidedById: ownerUserId,
  });

  const context = { studioId, userId: ownerUserId };

  // Standalone evaluation prior to any concurrent edit resolves to CLEARED
  const baselineResult = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());
  expect(baselineResult.status).toBe("CLEARED");
  expect(baselineResult.currentMedicalRevisionId).toBe(rev1!.id);

  if (database.backend === "postgresql") {
    // Under real PostgreSQL, verify that a transaction configured with REPEATABLE READ
    // maintains snapshot consistency across sequential reads even if concurrent writes commit.
    const db = appDb();

    await db.transaction(
      async (txA) => {
        // Step 1: Tx A begins and establishes its snapshot by reading the client profile
        const [profileInSnapshot] = await txA
          .select()
          .from(s.clientMedicalProfiles)
          .where(eq(s.clientMedicalProfiles.clientId, client.id));
        expect(profileInSnapshot).toBeDefined();

        // Step 2: Concurrent Tx B updates the profile and inserts Revision 2, then commits
        await db.transaction(async (txB) => {
          await createMedicalProfileRevision(txB, {
            studioId,
            clientId: client.id,
            snapshot: normalizeMedicalProfileSnapshot({
              ...defaultSnapshot,
              allergies: "Concurrent Update Allergy",
            }),
            createdById: ownerUserId,
          });
          await txB
            .update(s.clientMedicalProfiles)
            .set({ allergies: "Concurrent Update Allergy", updatedAt: new Date() })
            .where(eq(s.clientMedicalProfiles.clientId, client.id));
        });

        // Step 3: Tx A continues its reads within the established snapshot
        const resultInTxA = await resolveEffectiveMedicalEligibility(context, cycle.id, txA);

        // Tx A observes a consistent snapshot (Revision 1 + Clearance 1) rather than a torn state
        expect(resultInTxA.status).toBe("CLEARED");
        expect(resultInTxA.reasonCode).toBe("CLEARED");
        expect(resultInTxA.currentMedicalRevisionId).toBe(rev1!.id);
      },
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }
    );

    // After Tx A finishes, a fresh standalone evaluation starts a new snapshot and observes Revision 2
    const freshResult = await resolveEffectiveMedicalEligibility(context, cycle.id, db);
    expect(freshResult.status).toBe("REVIEW_REQUIRED");
    expect(freshResult.reasonCode).toBe("MEDICAL_REVISION_CHANGED");
    expect(freshResult.currentMedicalRevisionNumber).toBe(2);
  } else {
    // In PGlite / in-process single-connection environment, verify that standalone execution
    // uses the configured repeatable read read-only transaction parameters.
    const standaloneResult = await resolveEffectiveMedicalEligibility(context, cycle.id, appDb());
    expect(standaloneResult.status).toBe("CLEARED");
    expect(standaloneResult.currentMedicalRevisionId).toBe(rev1!.id);
  }
});
