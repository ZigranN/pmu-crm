import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({ id: null as string | null, studioId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.id ? { user: { id: session.id } } : null } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "pmu_active_studio" && session.studioId ? { value: session.studioId } : undefined) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let medical: typeof import("@/features/medical/server/actions");
let revisions: typeof import("@/features/medical/server/revisions");
type AppDb = typeof import("@/db").db;
const appDb = () => database.db as unknown as AppDb;
const userId = randomUUID();
let studioId: string, foreignStudioId: string, roleId: string;
const addedPermissions: string[] = [];
const codes = ["MEDICAL_PROFILE_UPDATE"];

const empty = { previousPMU: false, herpesHistory: false, diabetes: false, bloodThinners: false, keloidRisk: false,
  autoimmuneDiseases: false, recentBotoxFillers: false, recentPeelingLaser: false, skinSensitivity: false };
const full = { ...empty, allergies: "Latex", contraindications: "None", skinType: "Fitzpatrick II", pregnancyStatus: "not_pregnant",
  medications: "Vitamins", previousPMU: true, previousPMUNotes: "Brows 2022", diabetes: true, medicalNotes: "first" };
const snapshotOf = (input: Record<string, unknown>) => ({ allergies: null, contraindications: null, skinType: null, pregnancyStatus: null,
  medications: null, previousPMUNotes: null, medicalNotes: null, ...empty, ...input });

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  vi.doMock("@/db", () => ({ db }));
  medical = await import("@/features/medical/server/actions");
  revisions = await import("@/features/medical/server/revisions");
  [studioId, foreignStudioId] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(r => r.id);
  await db.insert(s.user).values({ id: userId, name: "Synthetic", email: `${userId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  [roleId] = (await db.insert(s.roles).values({ code: `TEST_${randomUUID()}`, name: "Test medical revisions" }).returning()).map(r => r.id);
  await db.insert(s.studioMembers).values([{ studioId, userId, roleId }, { studioId: foreignStudioId, userId, roleId }]);
  addedPermissions.push(...(await db.insert(s.permissions).values(codes.map(code => ({ code, name: code }))).onConflictDoNothing().returning()).map(r => r.id));
  const permissions = await db.select().from(s.permissions).where(inArray(s.permissions.code, codes));
  await db.insert(s.rolePermissions).values(permissions.map(p => ({ roleId, permissionId: p.id })));
});

beforeEach(() => { session.id = userId; session.studioId = studioId; });

afterAll(async () => {
  if (!database) return;
  try {
    await database.db.delete(s.auditLogs).where(eq(s.auditLogs.userId, userId));
    if (studioId) await database.db.delete(s.studios).where(inArray(s.studios.id, [studioId, foreignStudioId]));
    await database.db.delete(s.user).where(eq(s.user.id, userId));
    if (roleId) await database.db.delete(s.roles).where(eq(s.roles.id, roleId));
    if (addedPermissions.length) await database.db.delete(s.permissions).where(inArray(s.permissions.id, addedPermissions));
  } finally { await database.close(); }
});

async function newClient(studio = studioId) { return (await database.db.insert(s.clients).values(clientFixture(studio)).returning())[0].id; }
async function history(clientId: string, studio = studioId) { return revisions.getMedicalProfileRevisions(studio, clientId, appDb()); }
async function legacy(clientId: string) { return database.db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, clientId)); }
async function lastAudit(clientId: string) {
  return (await database.db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, clientId), eq(s.auditLogs.action, "medical_profile_updated"))).orderBy(desc(s.auditLogs.createdAt)))[0];
}
async function failAudit(entityId: string, run: () => Promise<void>) {
  const name = `test_fail_${randomUUID().replaceAll("-", "")}`;
  if (!/^[a-f0-9-]+$/.test(entityId)) throw new Error("Invalid fixture id");
  await database.db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = '${entityId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`));
  try {
    await database.db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    await run();
  } finally {
    await database.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`));
    await database.db.execute(sql.raw(`DROP FUNCTION ${name}()`));
  }
}

test("pure snapshot helpers are deterministic and ignore non-clinical columns", () => {
  const a = revisions.normalizeMedicalProfileSnapshot({ ...full, id: "x", clientId: "y", updatedAt: new Date(), supersededAt: null, mergeReviewRequired: true });
  expect(a).toEqual(snapshotOf(full));
  expect(Object.keys(a)).toEqual([...revisions.MEDICAL_PROFILE_SNAPSHOT_FIELDS]);
  expect(revisions.hasMedicalProfileChanges(a, revisions.normalizeMedicalProfileSnapshot(full))).toBe(false);
  expect(revisions.hasMedicalProfileChanges(a, { ...a, diabetes: false })).toBe(true);
  expect(revisions.hasMedicalProfileChanges(null, a)).toBe(true);
  expect(revisions.projectMedicalProfileSnapshot({ ...full }, { ...empty })).toEqual(snapshotOf({ ...full, ...empty }));
});

test("A. first-ever profile creates legacy row and revision #1 by the actor", async () => {
  const clientId = await newClient();
  await medical.upsertMedicalProfileAction(clientId, full);
  expect(await legacy(clientId)).toHaveLength(1);
  const rows = await history(clientId);
  expect(rows.map(r => [r.revisionNumber, r.createdById])).toEqual([[1, userId]]);
  expect(rows[0].snapshot).toEqual(snapshotOf(full));
  expect(rows[0].studioId).toBe(studioId);
  expect((await lastAudit(clientId)).metadata).toMatchObject({ medicalRevisionId: rows[0].id, medicalRevisionNumber: 1, newRevisionCreated: true, baselineRevisionCreated: false });
});

test("B. legacy profile without history + changed save seeds baseline #1 and appends #2", async () => {
  const clientId = await newClient();
  await database.db.insert(s.clientMedicalProfiles).values({ clientId, allergies: "Pollen", keloidRisk: true });
  const activity = await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId));
  await medical.upsertMedicalProfileAction(clientId, full);
  const rows = await history(clientId);
  expect(rows.map(r => [r.revisionNumber, r.createdById])).toEqual([[1, null], [2, userId]]);
  expect(rows[0].snapshot).toEqual(snapshotOf({ allergies: "Pollen", keloidRisk: true }));
  expect(rows[1].snapshot).toEqual(snapshotOf(full));
  const [row] = await legacy(clientId);
  expect(revisions.normalizeMedicalProfileSnapshot(row)).toEqual(rows[1].snapshot);
  expect((await lastAudit(clientId)).metadata).toMatchObject({ medicalRevisionId: rows[1].id, medicalRevisionNumber: 2, newRevisionCreated: true, baselineRevisionCreated: true });
  expect(await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId))).toHaveLength(activity.length + 1);
});

test("C. legacy profile without history + identical save seeds only baseline #1", async () => {
  const clientId = await newClient();
  await database.db.insert(s.clientMedicalProfiles).values({ clientId, ...full });
  await medical.upsertMedicalProfileAction(clientId, full);
  const rows = await history(clientId);
  expect(rows.map(r => [r.revisionNumber, r.createdById])).toEqual([[1, null]]);
  expect(rows[0].snapshot).toEqual(snapshotOf(full));
  expect((await lastAudit(clientId)).metadata).toMatchObject({ medicalRevisionId: rows[0].id, medicalRevisionNumber: 1, newRevisionCreated: false, baselineRevisionCreated: true });
});

test("D/E. changed save appends N+1; identical save appends nothing and reports latest", async () => {
  const clientId = await newClient();
  await medical.upsertMedicalProfileAction(clientId, full);
  await medical.upsertMedicalProfileAction(clientId, { ...full, medicalNotes: "second" });
  await medical.upsertMedicalProfileAction(clientId, { ...full, medicalNotes: "third" });
  expect((await history(clientId)).map(r => r.revisionNumber)).toEqual([1, 2, 3]);
  await medical.upsertMedicalProfileAction(clientId, { ...full, medicalNotes: "third" });
  const rows = await history(clientId);
  expect(rows.map(r => r.revisionNumber)).toEqual([1, 2, 3]);
  expect((await revisions.getLatestMedicalProfileRevision(studioId, clientId, appDb()))?.id).toBe(rows[2].id);
  expect((await lastAudit(clientId)).metadata).toMatchObject({ medicalRevisionId: rows[2].id, medicalRevisionNumber: 3, newRevisionCreated: false, baselineRevisionCreated: false });
});

test("F. failure after revision insert rolls back revisions, legacy profile, activity and audit", async () => {
  const clientId = await newClient();
  await database.db.insert(s.clientMedicalProfiles).values({ clientId, allergies: "Pollen" });
  const legacyBefore = await legacy(clientId);
  const activityBefore = await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId));
  const auditBefore = await database.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, clientId));
  await failAudit(clientId, async () => { await expect(medical.upsertMedicalProfileAction(clientId, full)).rejects.toThrow(); });
  expect(await history(clientId)).toEqual([]);
  expect(await legacy(clientId)).toEqual(legacyBefore);
  expect(await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId))).toEqual(activityBefore);
  expect(await database.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, clientId))).toEqual(auditBefore);
});

test("G. concurrent same-client saves receive distinct sequential revision numbers", async () => {
  const clientId = await newClient();
  await medical.upsertMedicalProfileAction(clientId, full);
  await Promise.all(["concurrent-a", "concurrent-b", "concurrent-c"].map(note => medical.upsertMedicalProfileAction(clientId, { ...full, medicalNotes: note })));
  const rows = await history(clientId);
  expect(rows.map(r => r.revisionNumber)).toEqual([1, 2, 3, 4]);
  expect(new Set(rows.slice(1).map(r => (r.snapshot as { medicalNotes: string }).medicalNotes))).toEqual(new Set(["concurrent-a", "concurrent-b", "concurrent-c"]));
  // Last committer wins for the legacy current row, and it matches the highest revision.
  const [row] = await legacy(clientId);
  expect(revisions.normalizeMedicalProfileSnapshot(row)).toEqual(rows[3].snapshot);
});

test("H. revision getters are tenant-scoped", async () => {
  const clientId = await newClient();
  const foreignClientId = await newClient(foreignStudioId);
  await medical.upsertMedicalProfileAction(clientId, full);
  session.studioId = foreignStudioId;
  await medical.upsertMedicalProfileAction(foreignClientId, full);
  const [foreign] = await history(foreignClientId, foreignStudioId);
  const [own] = await history(clientId);
  expect(await revisions.getMedicalProfileRevisionById(studioId, foreign.id, appDb())).toBeUndefined();
  expect((await revisions.getMedicalProfileRevisionById(foreignStudioId, foreign.id, appDb()))?.id).toBe(foreign.id);
  expect((await revisions.getMedicalProfileRevisionById(studioId, own.id, appDb()))?.id).toBe(own.id);
  expect(await history(foreignClientId, studioId)).toEqual([]);
  expect(await revisions.getLatestMedicalProfileRevision(studioId, foreignClientId, appDb())).toBeUndefined();
  expect(await history(clientId, foreignStudioId)).toEqual([]);
});

test("I. revisions are read back from PostgreSQL through a fresh connection", async () => {
  const clientId = await newClient();
  await medical.upsertMedicalProfileAction(clientId, full);
  const [written] = await history(clientId);
  if (database.backend === "postgresql") {
    const fresh = await createTestDatabase();
    try {
      const reread = await revisions.getMedicalProfileRevisions(studioId, clientId, fresh.db as unknown as AppDb);
      expect(reread.map(r => ({ id: r.id, revisionNumber: r.revisionNumber, snapshot: r.snapshot }))).toEqual([{ id: written.id, revisionNumber: 1, snapshot: snapshotOf(full) }]);
    } finally { await fresh.close(); }
  } else {
    const raw = await database.db.execute(sql`select revision_number, snapshot from medical_profile_revisions where id = ${written.id}`);
    const rows = (Array.isArray(raw) ? raw : (raw as unknown as { rows: unknown[] }).rows) as { revision_number: number; snapshot: unknown }[];
    expect(rows).toEqual([{ revision_number: 1, snapshot: snapshotOf(full) }]);
  }
});
