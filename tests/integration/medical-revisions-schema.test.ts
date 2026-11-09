import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let studioId: string;
let foreignStudioId: string;
let clientIdA: string;
let clientIdB: string;
let userId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const studios = await db
    .insert(s.studios)
    .values([studioFixture(), studioFixture()])
    .returning();
  studioId = studios[0].id;
  foreignStudioId = studios[1].id;

  userId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: userId,
    name: "Medical Auditor",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const clients = await db
    .insert(s.clients)
    .values([clientFixture(studioId), clientFixture(studioId)])
    .returning();
  clientIdA = clients[0].id;
  clientIdB = clients[1].id;
});

beforeEach(async () => {
  await db.delete(s.medicalProfileRevisions).where(eq(s.medicalProfileRevisions.studioId, studioId));
});

afterAll(async () => {
  if (!database) return;
  try {
    await db.delete(s.medicalProfileRevisions).where(eq(s.medicalProfileRevisions.studioId, studioId));
    await db.delete(s.clients).where(eq(s.clients.studioId, studioId));
    await db.delete(s.studios).where(eq(s.studios.id, studioId));
    await db.delete(s.studios).where(eq(s.studios.id, foreignStudioId));
    await db.delete(s.user).where(eq(s.user.id, userId));
  } finally {
    await database.close();
  }
});

test("A. Schema existence & persistence of all required fields", async () => {
  const sampleSnapshot = {
    allergies: "Penicillin",
    contraindications: "None",
    skinType: "Fitzpatrick II",
    pregnancyStatus: "not_pregnant",
    medications: "Vitamins",
    previousPMU: true,
    previousPMUNotes: "Brows 2022",
    herpesHistory: false,
    diabetes: false,
    bloodThinners: false,
    keloidRisk: false,
    autoimmuneDiseases: false,
    recentBotoxFillers: false,
    recentPeelingLaser: false,
    skinSensitivity: false,
    medicalNotes: "Client reported high pain threshold",
  };

  const [inserted] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 1,
      snapshot: sampleSnapshot,
      createdById: userId,
    })
    .returning();

  expect(inserted.id).toBeDefined();
  expect(inserted.studioId).toBe(studioId);
  expect(inserted.clientId).toBe(clientIdA);
  expect(inserted.revisionNumber).toBe(1);
  expect(inserted.snapshot).toEqual(sampleSnapshot);
  expect(inserted.createdById).toBe(userId);
  expect(inserted.createdAt).toBeInstanceOf(Date);

  const [queried] = await db
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, inserted.id));

  expect(queried).toBeDefined();
  expect(queried.id).toBe(inserted.id);
  expect(queried.snapshot).toEqual(sampleSnapshot);
  expect(queried.createdById).toBe(userId);
});

test("B. Revision number uniqueness per client and cross-client independence", async () => {
  const snapshot = { allergies: "None", skinType: "Normal" };

  // 1. Client A revision 1 succeeds
  const [rev1] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 1,
      snapshot,
      createdById: userId,
    })
    .returning();
  expect(rev1.revisionNumber).toBe(1);

  // 2. Client A revision 1 duplicate MUST fail at DB level
  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 1,
      snapshot: { allergies: "Pollen" },
      createdById: userId,
    })
  ).rejects.toThrow();

  // 3. Client B revision 1 MUST succeed (independent sequence per client)
  const [clientBRev1] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdB,
      revisionNumber: 1,
      snapshot,
      createdById: userId,
    })
    .returning();
  expect(clientBRev1.clientId).toBe(clientIdB);
  expect(clientBRev1.revisionNumber).toBe(1);

  // 4. Client A revision 2 succeeds
  const [rev2] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 2,
      snapshot: { ...snapshot, allergies: "Latex" },
      createdById: userId,
    })
    .returning();
  expect(rev2.revisionNumber).toBe(2);

  // 5. Positive revisionNumber check constraint (0 or negative must fail)
  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 0,
      snapshot,
      createdById: userId,
    })
  ).rejects.toThrow();

  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: clientIdA,
      revisionNumber: -1,
      snapshot,
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("C. Foreign key constraints and nullability semantics", async () => {
  const snapshot = { allergies: "None" };
  const invalidUuid = randomUUID();

  // Invalid studioId fails
  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId: invalidUuid,
      clientId: clientIdA,
      revisionNumber: 99,
      snapshot,
      createdById: userId,
    })
  ).rejects.toThrow();

  // Invalid clientId fails
  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: invalidUuid,
      revisionNumber: 99,
      snapshot,
      createdById: userId,
    })
  ).rejects.toThrow();

  // Invalid createdById fails FK constraint to user.id
  await expect(
    db.insert(s.medicalProfileRevisions).values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 99,
      snapshot,
      createdById: "non-existent-user-id",
    })
  ).rejects.toThrow();

  // Nullable createdById succeeds (system / unauthenticated baseline)
  const [nullActorRev] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 10,
      snapshot,
      createdById: null,
    })
    .returning();
  expect(nullActorRev.createdById).toBeNull();
});

test("D. Snapshot durability with complex JSON structures", async () => {
  const richSnapshot = {
    allergies: "Pollen, dust",
    contraindications: null,
    skinType: "Fitzpatrick III",
    customTags: ["sensitive", "high_anxiety"],
    clinicalAssessment: {
      pigmentTolerance: "normal",
      patchTestCompleted: true,
      patchTestDate: "2026-09-01",
      scores: [10, 20, 30],
    },
    metadata: {
      source: "intake_form_v2",
      verifiedByPractitioner: true,
    },
  };

  const [inserted] = await db
    .insert(s.medicalProfileRevisions)
    .values({
      studioId,
      clientId: clientIdA,
      revisionNumber: 50,
      snapshot: richSnapshot,
      createdById: userId,
    })
    .returning();

  const [persisted] = await db
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.id, inserted.id));

  expect(persisted.snapshot).toEqual(richSnapshot);
  expect((persisted.snapshot as typeof richSnapshot).clinicalAssessment.scores).toEqual([10, 20, 30]);
  expect((persisted.snapshot as typeof richSnapshot).clinicalAssessment.patchTestCompleted).toBe(true);
});

test("E. Legacy client_medical_profiles independence and zero backfill", async () => {
  // 1. Create a legacy medical profile row
  const [legacy] = await db
    .insert(s.clientMedicalProfiles)
    .values({
      clientId: clientIdB,
      allergies: "Ibuprofen",
      skinType: "Fitzpatrick IV",
    })
    .returning();

  expect(legacy.id).toBeDefined();
  expect(legacy.clientId).toBe(clientIdB);

  // 2. Verify no medical_profile_revisions rows are auto-generated
  const revisions = await db
    .select()
    .from(s.medicalProfileRevisions)
    .where(eq(s.medicalProfileRevisions.clientId, clientIdB));

  expect(revisions).toHaveLength(0);

  // Clean up legacy profile
  await db.delete(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.id, legacy.id));
});
