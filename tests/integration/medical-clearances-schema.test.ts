import { beforeAll, beforeEach, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let studioId: string;
let clientId: string;
let userId: string;
let cycleIdA: string;
let cycleIdB: string;
let revisionId1: string;
let revisionId2: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const studios = await db
    .insert(s.studios)
    .values([studioFixture(), studioFixture()])
    .returning();
  studioId = studios[0].id;

  userId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: userId,
    name: "Medical Reviewer",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [client] = await db
    .insert(s.clients)
    .values([clientFixture(studioId)])
    .returning();
  clientId = client.id;

  const cycles = await db
    .insert(s.treatmentCycles)
    .values([
      {
        studioId,
        clientId,
        zoneCode: "brows",
        kind: "pmu",
        stage: "qualification",
        version: 1,
      },
      {
        studioId,
        clientId,
        zoneCode: "lips",
        kind: "pmu",
        stage: "qualification",
        version: 1,
      },
    ])
    .returning();
  cycleIdA = cycles[0].id;
  cycleIdB = cycles[1].id;

  const revisions = await db
    .insert(s.medicalProfileRevisions)
    .values([
      {
        studioId,
        clientId,
        revisionNumber: 1,
        snapshot: { allergies: "None", skinType: "Fitzpatrick II" },
        createdById: userId,
      },
      {
        studioId,
        clientId,
        revisionNumber: 2,
        snapshot: { allergies: "Latex", skinType: "Fitzpatrick II" },
        createdById: userId,
      },
    ])
    .returning();
  revisionId1 = revisions[0].id;
  revisionId2 = revisions[1].id;
});

beforeEach(async () => {
  await db.delete(s.cycleMedicalClearances).where(eq(s.cycleMedicalClearances.studioId, studioId));
});

test("A. Persistence: insert and read all fields", async () => {
  const [inserted] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Client has no contraindications for brow procedure.",
      clinicalNotes: "Skin barrier intact, patch test negative.",
      decidedById: userId,
    })
    .returning();

  expect(inserted.id).toBeDefined();
  expect(inserted.studioId).toBe(studioId);
  expect(inserted.cycleId).toBe(cycleIdA);
  expect(inserted.medicalRevisionId).toBe(revisionId1);
  expect(inserted.decisionNumber).toBe(1);
  expect(inserted.decision).toBe("CLEARED");
  expect(inserted.reason).toBe("Client has no contraindications for brow procedure.");
  expect(inserted.clinicalNotes).toBe("Skin barrier intact, patch test negative.");
  expect(inserted.decidedById).toBe(userId);
  expect(inserted.createdAt).toBeInstanceOf(Date);

  const [persisted] = await db
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.id, inserted.id));

  expect(persisted).toBeDefined();
  expect(persisted.decisionNumber).toBe(1);
  expect(persisted.decision).toBe("CLEARED");
  expect(persisted.clinicalNotes).toBe("Skin barrier intact, patch test negative.");
});

test("B. Decision enum/check constraint: only accepts 3 human decisions and positive sequence numbers", async () => {
  // 1. Valid decisions
  const decisions = ["CLEARED", "CONSULTATION_REQUIRED", "NOT_CLEARED"] as const;
  for (let i = 0; i < decisions.length; i++) {
    const [row] = await db
      .insert(s.cycleMedicalClearances)
      .values({
        studioId,
        cycleId: cycleIdA,
        medicalRevisionId: revisionId1,
        decisionNumber: i + 1,
        decision: decisions[i],
        reason: `Valid decision test for ${decisions[i]}`,
        decidedById: userId,
      })
      .returning();
    expect(row.decision).toBe(decisions[i]);
  }

  // 2. Reject derived/unsupported values
  const invalidDecisions = [
    "REVIEW_REQUIRED",
    "NO_MEDICAL_PROFILE",
    "PENDING",
    "APPROVED",
    "cleared",
  ];

  for (const invalid of invalidDecisions) {
    await expect(
      db.insert(s.cycleMedicalClearances).values({
        studioId,
        cycleId: cycleIdB,
        medicalRevisionId: revisionId1,
        decisionNumber: 1,
        decision: invalid as unknown as s.CycleMedicalClearanceDecision,
        reason: "Invalid decision test",
        decidedById: userId,
      })
    ).rejects.toThrow();
  }

  // 3. Reject non-positive decision numbers
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycleIdB,
      medicalRevisionId: revisionId1,
      decisionNumber: 0,
      decision: "CLEARED",
      reason: "Zero decision number",
      decidedById: userId,
    })
  ).rejects.toThrow();

  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycleIdB,
      medicalRevisionId: revisionId1,
      decisionNumber: -1,
      decision: "CLEARED",
      reason: "Negative decision number",
      decidedById: userId,
    })
  ).rejects.toThrow();
});

test("C. Sequence uniqueness: per-cycle unique decisionNumber", async () => {
  // Decision 1 on Cycle A
  await db.insert(s.cycleMedicalClearances).values({
    studioId,
    cycleId: cycleIdA,
    medicalRevisionId: revisionId1,
    decisionNumber: 1,
    decision: "CONSULTATION_REQUIRED",
    reason: "First review",
    decidedById: userId,
  });

  // Duplicate Decision 1 on same Cycle A must fail
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId2,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Duplicate sequence number on same cycle",
      decidedById: userId,
    })
  ).rejects.toThrow();

  // Decision 1 on different Cycle B must succeed
  const [rowB] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId,
      cycleId: cycleIdB,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "First review on different cycle",
      decidedById: userId,
    })
    .returning();

  expect(rowB.decisionNumber).toBe(1);
  expect(rowB.cycleId).toBe(cycleIdB);
});

test("D. Same revision re-review: same cycle + same medicalRevisionId + multiple decision rows", async () => {
  // Canonical scenario:
  // cycle A + revision R + decision #1 = CONSULTATION_REQUIRED
  const [dec1] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CONSULTATION_REQUIRED",
      reason: "Dermatology consultation required due to active eczema history.",
      decidedById: userId,
    })
    .returning();

  // cycle A + same revision R + decision #2 = CLEARED
  const [dec2] = await db
    .insert(s.cycleMedicalClearances)
    .values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId1,
      decisionNumber: 2,
      decision: "CLEARED",
      reason: "Doctor clearance letter reviewed and accepted.",
      decidedById: userId,
    })
    .returning();

  expect(dec1.id).toBeDefined();
  expect(dec2.id).toBeDefined();
  expect(dec1.id).not.toBe(dec2.id);

  const history = await db
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, cycleIdA))
    .orderBy(s.cycleMedicalClearances.decisionNumber);

  expect(history).toHaveLength(2);
  expect(history[0].decisionNumber).toBe(1);
  expect(history[0].decision).toBe("CONSULTATION_REQUIRED");
  expect(history[0].medicalRevisionId).toBe(revisionId1);

  expect(history[1].decisionNumber).toBe(2);
  expect(history[1].decision).toBe("CLEARED");
  expect(history[1].medicalRevisionId).toBe(revisionId1);
});

test("E. Foreign keys: validate references to studio, cycle, medical revision, and user", async () => {
  const nonExistentUuid = randomUUID();

  // 1. Invalid studioId
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId: nonExistentUuid,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Invalid studio",
      decidedById: userId,
    })
  ).rejects.toThrow();

  // 2. Invalid cycleId
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: nonExistentUuid,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Invalid cycle",
      decidedById: userId,
    })
  ).rejects.toThrow();

  // 3. Invalid medicalRevisionId
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: nonExistentUuid,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Invalid revision",
      decidedById: userId,
    })
  ).rejects.toThrow();

  // 4. Invalid decidedById
  await expect(
    db.insert(s.cycleMedicalClearances).values({
      studioId,
      cycleId: cycleIdA,
      medicalRevisionId: revisionId1,
      decisionNumber: 1,
      decision: "CLEARED",
      reason: "Invalid user",
      decidedById: "non-existent-user-id",
    })
  ).rejects.toThrow();
});

test("F. No backfill / zero fabrication on independent records", async () => {
  // Creating cycles or medical profile revisions does not fabricate clearances
  const freshClient = (
    await db
      .insert(s.clients)
      .values([clientFixture(studioId)])
      .returning()
  )[0];

  const freshCycle = (
    await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: freshClient.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "new_lead",
        version: 1,
      })
      .returning()
  )[0];

  const freshRevision = (
    await db
      .insert(s.medicalProfileRevisions)
      .values({
        studioId,
        clientId: freshClient.id,
        revisionNumber: 1,
        snapshot: { allergies: "None" },
        createdById: userId,
      })
      .returning()
  )[0];

  expect(freshCycle.id).toBeDefined();
  expect(freshRevision.id).toBeDefined();

  const clearances = await db
    .select()
    .from(s.cycleMedicalClearances)
    .where(eq(s.cycleMedicalClearances.cycleId, freshCycle.id));

  expect(clearances).toHaveLength(0);
});

test("G. Parent-table integrity: clearance rows do not mutate cycle stage/version or revision data", async () => {
  const [cycleBefore] = await db
    .select()
    .from(s.treatmentCycles)
    .where(eq(s.treatmentCycles.id, cycleIdA));

  const [revisionBefore] = await db
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, revisionId1));

  // Insert clearance
  await db.insert(s.cycleMedicalClearances).values({
    studioId,
    cycleId: cycleIdA,
    medicalRevisionId: revisionId1,
    decisionNumber: 1,
    decision: "CLEARED",
    reason: "Clearance recorded without workflow side effects",
    decidedById: userId,
  });

  const [cycleAfter] = await db
    .select()
    .from(s.treatmentCycles)
    .where(eq(s.treatmentCycles.id, cycleIdA));

  const [revisionAfter] = await db
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, revisionId1));

  expect(cycleAfter.stage).toBe(cycleBefore.stage);
  expect(cycleAfter.version).toBe(cycleBefore.version);
  expect(cycleAfter.updatedAt).toEqual(cycleBefore.updatedAt);

  expect(revisionAfter.revisionNumber).toBe(revisionBefore.revisionNumber);
  expect(revisionAfter.snapshot).toEqual(revisionBefore.snapshot);
});
