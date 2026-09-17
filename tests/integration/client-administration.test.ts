import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { administrativeQualificationSchema, clientSchema, type ClientSchema } from "@/features/clients/schemas/client.schema";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let actions: typeof import("@/features/clients/server/actions"), admin: typeof import("@/features/clients/server/administration"), queries: typeof import("@/features/clients/server/queries");
const actor = randomUUID(), other = randomUUID(); let studioId: string, foreignStudio: string, clientId: string, masterId: string, secondMaster: string, foreignMaster: string, roleIds: Record<string, string>;
const base: ClientSchema = { firstName: "Synthetic", phone: "+390000000000", clientStatus: "new_lead" };
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  actions = await import("@/features/clients/server/actions"); admin = await import("@/features/clients/server/administration"); queries = await import("@/features/clients/server/queries");
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(row => row.id);
  await db.insert(s.user).values([actor, other].map(id => ({ id, name: "Synthetic", email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() })));
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map(row => [row.code, row.id]));
  await db.insert(s.studioMembers).values([{ studioId, userId: actor, roleId: roleIds.OWNER }, { studioId, userId: other, roleId: roleIds.MASTER }]);
  [masterId, secondMaster] = (await db.insert(s.masters).values([{ studioId, displayName: "Assigned", userId: actor }, { studioId, displayName: "Preferred", userId: other }]).returning()).map(row => row.id);
  [foreignMaster] = (await db.insert(s.masters).values({ studioId: foreignStudio, displayName: "Foreign" }).returning()).map(row => row.id);
});
beforeEach(async () => {
  session.id = actor; await db.update(s.studioMembers).set({ roleId: roleIds.OWNER }).where(eq(s.studioMembers.userId, actor));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
  [clientId] = (await db.insert(s.clients).values({ ...clientFixture(studioId), phone: "+390000000001", assignedMasterId: masterId, treatmentZone: "Old free text", source: "Legacy campaign" }).returning()).map(row => row.id);
});
afterAll(async () => { try { await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.studios).where(eq(s.studios.id, foreignStudio)); await db.delete(s.user).where(sql`${s.user.id} in (${actor}, ${other})`); } finally { await database.close(); } });
const row = async () => (await db.select().from(s.clients).where(eq(s.clients.id, clientId)))[0];
const preferred = (id: string | null, expected: string | null = null, key = randomUUID()) => admin.setPreferredMaster({ clientId, masterId: id, expectedMasterId: expected, reason: "Client preference confirmed" }, key);
test("new administrative fields roundtrip, retry remains idempotent, pipeline status is independent of returning kind", async () => {
  const input: ClientSchema = { ...base, language: "it", interestedZones: ["brows", "lips"], clientKind: "returning", reportedPreviousPmu: true, source: "referral" };
  const key = randomUUID(), first = await actions.createClientAction(input, key), retry = await actions.createClientAction(input, key); expect(first).toEqual(retry);
  expect(await queries.getClientById(first.id, studioId)).toMatchObject({ language: "it", interestedZones: ["brows", "lips"], clientKind: "returning", clientStatus: "new_lead", reportedPreviousPmu: true });
});
test("legacy values and unknowns survive unrelated edits; no medical PMU fact is inferred", async () => {
  await db.insert(s.clientMedicalProfiles).values({ clientId, previousPMU: true, medicalNotes: "Clinical assessment" });
  const before = await row(); expect(before).toMatchObject({ language: null, clientKind: null, interestedZones: null, reportedPreviousPmu: null, preferredMasterId: null });
  await actions.updateClientAction(clientId, { ...base, firstName: "Renamed" });
  expect(await row()).toMatchObject({ treatmentZone: "Old free text", source: "Legacy campaign", reportedPreviousPmu: null, assignedMasterId: masterId });
});
test("reported PMU can be yes/no/unknown without modifying medical profile; empty and unknown interests are distinct", async () => {
  const [medical] = await db.insert(s.clientMedicalProfiles).values({ clientId, previousPMU: true, medicalNotes: "Unchanged clinical data" }).returning();
  for (const reportedPreviousPmu of [true, false, null]) {
    await actions.updateClientAction(clientId, { ...base, reportedPreviousPmu, interestedZones: [] }); expect(await row()).toMatchObject({ reportedPreviousPmu, interestedZones: [] });
  }
  await actions.updateClientAction(clientId, { ...base, interestedZones: null }); expect((await row()).interestedZones).toBeNull();
  expect((await db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, clientId)))[0]).toEqual(medical);
});
test("strict admin/AI qualification allowlists reject medical, price, status and assignment payloads", async () => {
  expect(administrativeQualificationSchema.parse({ language: "it", reportedPreviousPmu: true })).toEqual({ language: "it", reportedPreviousPmu: true });
  for (const field of ["medicalClearance", "medicalNotes", "allergies", "medications", "previousPMU", "assignedMasterId", "preferredMasterId", "ltvCents", "agreedPrice", "studioId", "treatmentZone"]) {
    expect(clientSchema.safeParse({ ...base, [field]: "forged" }).success).toBe(false);
    expect(administrativeQualificationSchema.safeParse({ [field]: "forged" }).success).toBe(false);
    await expect(actions.updateClientAction(clientId, { ...base, [field]: "forged" } as ClientSchema)).rejects.toThrow();
  }
  for (const field of ["clientStatus", "notes", "leadStatus", "tags", "birthDate"]) expect(administrativeQualificationSchema.safeParse({ [field]: "forged" }).success).toBe(false);
});
test("invalid zones/languages, duplicates and invalid kinds are rejected in schema and database", async () => {
  for (const data of [{ language: "made-up" }, { interestedZones: ["free text"] }, { interestedZones: ["brows", "brows"] }, { clientKind: "VIP" }]) expect(clientSchema.safeParse({ ...base, ...data }).success).toBe(false);
  await expect(db.update(s.clients).set({ language: "invalid" }).where(eq(s.clients.id, clientId))).rejects.toThrow();
  await expect(db.update(s.clients).set({ interestedZones: ["free text"] }).where(eq(s.clients.id, clientId))).rejects.toThrow();
  await expect(db.update(s.clients).set({ clientKind: "VIP" }).where(eq(s.clients.id, clientId))).rejects.toThrow();
});
test("preferred master is separate from assignment and never grants that master access", async () => {
  const key = randomUUID(); await preferred(secondMaster, null, key); await preferred(secondMaster, null, key);
  expect(await row()).toMatchObject({ preferredMasterId: secondMaster, assignedMasterId: masterId });
  expect(await queries.getClientMasterLabels(clientId, studioId)).toMatchObject({ assignedName: "Assigned", preferredName: "Preferred" });
  expect(await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, clientId), eq(s.auditLogs.action, "client_preferred_master_changed")))).toHaveLength(1);
  session.id = other;
  expect(await queries.getClientById(clientId, studioId)).toBeUndefined(); expect(await queries.getClientMasterLabels(clientId, studioId)).toBeUndefined();
});
test("Owner/Admin can change preference; stale, foreign and inactive choices fail", async () => {
  await db.update(s.studioMembers).set({ roleId: roleIds.ADMIN }).where(eq(s.studioMembers.userId, actor));
  await preferred(secondMaster); await expect(preferred(null)).rejects.toThrow("уже изменилось");
  await expect(preferred(foreignMaster, secondMaster)).rejects.toThrow("Master not found");
  await db.update(s.masters).set({ isActive: false }).where(eq(s.masters.id, secondMaster));
  try { await expect(preferred(secondMaster, secondMaster)).rejects.toThrow("Master not found"); }
  finally { await db.update(s.masters).set({ isActive: true }).where(eq(s.masters.id, secondMaster)); }
  await preferred(null, secondMaster); expect((await row()).preferredMasterId).toBeNull();
  await expect(db.update(s.clients).set({ preferredMasterId: foreignMaster }).where(eq(s.clients.id, clientId))).rejects.toThrow();
});
test("assigned Master can update administrative facts but not preference; AI human actions stay blocked", async () => {
  await db.update(s.studioMembers).set({ roleId: roleIds.MASTER }).where(eq(s.studioMembers.userId, actor));
  await actions.updateClientAction(clientId, { ...base, language: "en", reportedPreviousPmu: false });
  await expect(preferred(secondMaster)).rejects.toThrow("Permission denied");
  await db.update(s.studioMembers).set({ roleId: roleIds.AI_SYSTEM }).where(eq(s.studioMembers.userId, actor));
  await expect(actions.createClientAction({ ...base, language: "it" }, randomUUID())).rejects.toThrow("Permission denied");
  await expect(actions.updateClientAction(clientId, { ...base, reportedPreviousPmu: true })).rejects.toThrow("Permission denied");
  await expect(preferred(secondMaster)).rejects.toThrow("Permission denied");
});
test("audit failure rolls back administrative facts, preference, and its receipt", async () => {
  await db.execute(sql`alter table audit_logs add constraint reject_admin_test check (action not in ('client_updated','client_preferred_master_changed')) not valid`);
  try {
    await expect(actions.updateClientAction(clientId, { ...base, language: "en" })).rejects.toThrow();
    await expect(preferred(secondMaster)).rejects.toThrow();
    expect(await row()).toMatchObject({ language: null, preferredMasterId: null });
    expect(await db.select().from(s.commandReceipts).where(and(eq(s.commandReceipts.studioId, studioId), eq(s.commandReceipts.command, "client.preferred-master.v1")))).not.toContainEqual(expect.objectContaining({ result: { clientId } }));
  } finally { await db.execute(sql`alter table audit_logs drop constraint reject_admin_test`); }
});
