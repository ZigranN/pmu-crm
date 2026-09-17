import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { canonicalPhone, canonicalEmail, canonicalInstagram, canonicalName } from "@/features/clients/contacts";
import type { ClientSchema } from "@/features/clients/schemas/client.schema";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let actions: typeof import("@/features/clients/server/actions"), previews: typeof import("@/features/clients/server/duplicate-actions");
const actor = randomUUID(); let studioId: string, foreignStudio: string, roleIds: Record<string, string>;
const input: ClientSchema = { firstName: "Anna", lastName: "Rossi", phone: "+39 333 123 4567", email: "ANNA@example.test", instagram: "@Anna.rossi", clientStatus: "new_lead" };
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  actions = await import("@/features/clients/server/actions"); previews = await import("@/features/clients/server/duplicate-actions");
  await db.insert(s.user).values({ id: actor, name: "Synthetic", email: `${actor}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map(row => [row.code, row.id]));
});
beforeEach(async () => {
  session.id = actor;
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(row => row.id);
  await db.insert(s.studioMembers).values({ studioId, userId: actor, roleId: roleIds.OWNER });
});
afterEach(async () => { await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.studios).where(eq(s.studios.id, foreignStudio)); });
afterAll(async () => { try { await db.delete(s.user).where(eq(s.user.id, actor)); } finally { await database.close(); } });
async function legacy(values: Partial<typeof s.clients.$inferInsert> = {}) {
  return (await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Anna", fullName: "Anna Rossi", phone: "+39 (333) 123-4567", email: " ANNA@example.test ", instagram: "https://www.instagram.com/Anna.rossi/", ...values }).returning())[0];
}
const review = (value = input, excludeId?: string) => previews.reviewClientDuplicates(value, excludeId);
test("JS and generated SQL contact keys agree on formatting, country prefix, casing and invalid values", async () => {
  const cases = ["+39 (06) 1234-5678", "0039 3331234567", "3331234567", "8 999 123 45 67", "+1 202 555 0101", "+1234567890123456", "call +393331234567", "", null];
  for (const value of cases) {
    const [row] = await db.select({ key: sql<string | null>`pmu_phone_key(${value})` }).from(s.studios).where(eq(s.studios.id, studioId)); expect(row.key).toBe(canonicalPhone(value));
  }
  for (const value of [" A.B+tag@Example.test ", "broken", null]) {
    const [row] = await db.select({ key: sql<string | null>`pmu_email_key(${value})` }).from(s.studios).where(eq(s.studios.id, studioId)); expect(row.key).toBe(canonicalEmail(value));
  }
  for (const value of ["@Anna.Rossi", "https://www.instagram.com/Anna.Rossi/", "anna..rossi", "https://evil.test/anna", null]) {
    const [row] = await db.select({ key: sql<string | null>`pmu_instagram_key(${value})` }).from(s.studios).where(eq(s.studios.id, studioId)); expect(row.key).toBe(canonicalInstagram(value));
  }
  const name = "  ANNA   Rossi "; expect((await db.select({ key: sql<string>`pmu_name_key(${name})` }).from(s.studios).where(eq(s.studios.id, studioId)))[0].key).toBe(canonicalName(name));
});
test("legacy raw values remain intact while computed keys identify exact matching contacts", async () => {
  const row = await legacy(); const result = await review();
  expect(result.candidates).toHaveLength(1); expect(result.candidates[0]).toMatchObject({ id: row.id, level: "exact", reasons: ["Телефон / WhatsApp", "Email", "Instagram", "Имя"] });
  expect((await db.select().from(s.clients).where(eq(s.clients.id, row.id)))[0]).toEqual(row);
  expect(row).toMatchObject({ phone: "+39 (333) 123-4567", phoneKey: "+393331234567", email: " ANNA@example.test ", emailKey: "anna@example.test", instagramKey: "anna.rossi" });
});
test("phone and WhatsApp match across fields; blank contacts never match each other", async () => {
  await legacy({ phone: "+390612345678", whatsapp: "+393331234567", email: null, instagram: null, fullName: "Different Person" });
  expect((await review({ ...input, email: "", instagram: "" })).candidates[0].reasons).toEqual(["Телефон / WhatsApp"]);
  expect((await review({ ...input, firstName: "Unrelated", lastName: "Person", phone: "+442079460123", email: "", instagram: "" })).candidates).toHaveLength(0);
});
test("same/similar names with different contacts are possible candidates, never an automatic identity", async () => {
  await legacy({ phone: "+442079460123", email: "other@example.test", instagram: null, fullName: "Anna Rosi" });
  const result = await actions.attemptCreateClientAction(input, randomUUID()); expect(result.kind).toBe("review");
  if (result.kind === "review") expect(result.review.candidates[0]).toMatchObject({ level: "possible", reasons: ["Похожее имя"] });
  expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
});
test("parallel create with different keys creates one client and requires review for the other", async () => {
  const results = await Promise.all([actions.attemptCreateClientAction(input, randomUUID()), actions.attemptCreateClientAction(input, randomUUID())]);
  expect(results.map(row => row.kind).sort()).toEqual(["created", "review"]);
  expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
  expect(await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId))).toHaveLength(1);
});
test("shared contact requires explicit Owner/Admin reason; retry returns original even without re-sending decision", async () => {
  await legacy(); await db.update(s.studioMembers).set({ roleId: roleIds.ADMIN }).where(eq(s.studioMembers.userId, actor));
  const other = { ...input, firstName: "Maria" }, checked = await review(other), key = randomUUID();
  const created = await actions.createClientAction(other, key, { token: checked.token, reason: "Mother and daughter share a family number" });
  expect(await actions.createClientAction(other, key)).toEqual(created);
  const decisions = await db.select().from(s.clientDuplicateDecisions).where(eq(s.clientDuplicateDecisions.studioId, studioId));
  expect(decisions).toHaveLength(1); expect(decisions[0]).toMatchObject({ clientId: created.id, actorId: actor, reason: "Mother and daughter share a family number" });
  expect(await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.studioId, studioId), eq(s.auditLogs.action, "client_duplicate_accepted")))).toHaveLength(1);
});
test("stale or invented review token and missing reason cannot approve a new duplicate", async () => {
  const row = await legacy(), checked = await review();
  await db.update(s.clients).set({ fullName: "Anna Changed" }).where(eq(s.clients.id, row.id));
  await expect(actions.createClientAction(input, randomUUID(), { token: checked.token, reason: "Shared contact" })).rejects.toThrow("совпадения");
  await expect(actions.createClientAction(input, randomUUID(), { token: "a".repeat(64), reason: "Shared contact" })).rejects.toThrow("совпадения");
  await expect(actions.createClientAction(input, randomUUID(), { token: (await review()).token, reason: " " })).rejects.toThrow();
});
test("archived clients remain candidates for Owner/Admin and are never restored implicitly", async () => {
  const archived = await legacy({ deletedAt: new Date(), deletedById: actor });
  expect((await review()).candidates[0]).toMatchObject({ id: archived.id, archived: true });
  expect((await actions.attemptCreateClientAction(input, randomUUID())).kind).toBe("review");
  expect((await db.select().from(s.clients).where(eq(s.clients.id, archived.id)))[0].deletedAt).not.toBeNull();
});
test("excluded client is authorized; cross-studio and non-assigned candidates never leak to Master", async () => {
  const own = await legacy(), foreign = await legacy({ studioId: foreignStudio });
  expect((await review(input, own.id)).candidates).toHaveLength(0);
  await expect(review(input, foreign.id)).rejects.toThrow("Client not found");
  const [master] = await db.insert(s.masters).values({ studioId, userId: actor, displayName: "Master" }).returning();
  await db.update(s.studioMembers).set({ roleId: roleIds.MASTER }).where(eq(s.studioMembers.userId, actor));
  expect((await review()).candidates).toHaveLength(0);
  await db.update(s.clients).set({ assignedMasterId: master.id }).where(eq(s.clients.id, own.id));
  expect((await review()).candidates.map(row => row.id)).toEqual([own.id]);
  await expect(actions.createClientAction(input, randomUUID(), { token: (await review()).token, reason: "Not allowed" })).rejects.toThrow("Permission denied");
  await db.update(s.studioMembers).set({ roleId: roleIds.AI_SYSTEM }).where(eq(s.studioMembers.userId, actor));
  await expect(review()).rejects.toThrow("Permission denied");
});
test("contact edit refreshes computed keys and preserves omitted WhatsApp; unchanged legacy local phone remains editable", async () => {
  const row = await legacy({ phone: "3331234567", whatsapp: "+390612345678", email: "other@example.test", instagram: null });
  await actions.updateClientAction(row.id, { firstName: "Renamed", phone: row.phone, clientStatus: "new_lead" });
  expect((await db.select().from(s.clients).where(eq(s.clients.id, row.id)))[0]).toMatchObject({ phone: "3331234567", phoneKey: null, whatsapp: "+390612345678" });
  await actions.updateClientAction(row.id, { firstName: "Renamed", phone: "+39 333 123 4567", clientStatus: "new_lead" });
  expect((await review()).candidates[0].id).toBe(row.id);
  await expect(actions.createClientAction({ ...input, phone: "3331234567" }, randomUUID())).rejects.toThrow("кодом страны");
});
test("review logging is fail-closed and stores IDs without contact values", async () => {
  await legacy(); await review();
  const [log] = await db.select().from(s.accessLogs).where(eq(s.accessLogs.studioId, studioId)); expect(log.recordCount).toBe(1); expect(JSON.stringify(log)).not.toContain("anna@example");
  await db.execute(sql`alter table access_logs add constraint reject_duplicate_reads check (operation != 'clients.duplicates') not valid`);
  try { await expect(review()).rejects.toThrow("Access logging unavailable"); }
  finally { await db.execute(sql`alter table access_logs drop constraint reject_duplicate_reads`); }
});
test("approval audit failure rolls back separate client, decision, receipt and outbox", async () => {
  await legacy(); const checked = await review();
  await db.execute(sql`alter table audit_logs add constraint reject_duplicate_audit check (action != 'client_duplicate_accepted')`);
  try {
    await expect(actions.createClientAction(input, randomUUID(), { token: checked.token, reason: "Shared number" })).rejects.toThrow();
    expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
    for (const table of [s.clientDuplicateDecisions, s.commandReceipts, s.outboxJobs]) expect(await db.select().from(table).where(eq(table.studioId, studioId))).toHaveLength(0);
  } finally { await db.execute(sql`alter table audit_logs drop constraint reject_duplicate_audit`); }
});
test("large candidate sets are bounded and cannot be silently approved", async () => {
  await db.insert(s.clients).values(Array.from({ length: 201 }, (_, i) => ({ ...clientFixture(studioId), fullName: `Person ${i}`, phone: "+393331234567" })));
  const checked = await review(); expect(checked.truncated).toBe(true); expect(checked.candidates).toHaveLength(200);
  await expect(actions.createClientAction(input, randomUUID(), { token: checked.token, reason: "Too broad" })).rejects.toThrow("совпадения");
});
