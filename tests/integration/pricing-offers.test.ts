import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import type { OfferInput } from "@/features/offers/schema";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let actions: typeof import("@/features/offers/server/actions"), queries: typeof import("@/features/offers/server/queries"), catalog: typeof import("@/features/services/server/actions"), pricing: typeof import("@/features/services/server/pricing");
const actor = randomUUID(); let studioId: string, foreignStudio: string, clientId: string, foreignClient: string, masterId: string;
let serviceRows: (typeof s.services.$inferSelect)[], roleIds: Record<string, string>;
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  actions = await import("@/features/offers/server/actions"); queries = await import("@/features/offers/server/queries"); catalog = await import("@/features/services/server/actions"); pricing = await import("@/features/services/server/pricing");
  await db.insert(s.user).values({ id: actor, name: "Synthetic approver", email: `${actor}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map(row => [row.code, row.id]));
});
beforeEach(async () => {
  session.id = actor;
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(row => row.id);
  await db.insert(s.studioMembers).values({ studioId, userId: actor, roleId: roleIds.OWNER });
  [clientId, foreignClient] = (await db.insert(s.clients).values([clientFixture(studioId), clientFixture(foreignStudio)]).returning()).map(row => row.id);
  await catalog.importPhase3Catalog();
  serviceRows = await db.select().from(s.services).where(eq(s.services.studioId, studioId));
  [masterId] = (await db.insert(s.masters).values({ studioId, displayName: "Synthetic master" }).returning()).map(row => row.id);
  await db.insert(s.masterServices).values(serviceRows.map(row => ({ studioId, masterId, serviceId: row.id })));
});
afterEach(async () => { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.studios).where(eq(s.studios.id, foreignStudio)); });
afterAll(async () => { try { await db.delete(s.user).where(eq(s.user.id, actor)); } finally { await database.close(); } });
const serviceId = (code: string) => serviceRows.find(row => row.catalogCode === code)!.id;
const role = (code: string) => db.update(s.studioMembers).set({ roleId: roleIds[code] }).where(eq(s.studioMembers.userId, actor));
const price = (code: string, master: string | null = null) => db.transaction(tx => pricing.resolvePrice(tx, studioId, serviceId(code), master));
async function offer(): Promise<OfferInput> {
  const brows = await price("brows-hair", masterId), eyes = await price("eyes-lashline");
  return { offerId: null, clientId, expectedRevision: 0, agreedTotalCents: 85000, reason: "Approved multi-zone offer", items: [
    { serviceId: brows.serviceId, masterId, standardCents: null, priceVersion: brows.version }, { serviceId: eyes.serviceId, masterId: null, standardCents: null, priceVersion: eyes.version },
  ] };
}
async function override(priceCents: number | null, expectedRevision = 0, key = randomUUID()) {
  return actions.saveMasterPrice({ serviceId: serviceId("brows-hair"), masterId, priceCents, expectedRevision, reason: "Approved master price" }, key);
}
test("master price overrides base, reset restores live base, histories are retained", async () => {
  expect(await price("brows-hair", masterId)).toMatchObject({ source: "service_base", priceCents: 60000 });
  await override(65025); expect(await price("brows-hair", masterId)).toMatchObject({ source: "master_override", priceCents: 65025 });
  expect(await price("brows-hair")).toMatchObject({ priceCents: 60000 });
  await override(null, 1); expect(await price("brows-hair", masterId)).toMatchObject({ source: "service_base", priceCents: 60000, overrideRevision: 2 });
  expect(await db.select().from(s.masterPriceRevisions).where(eq(s.masterPriceRevisions.studioId, studioId))).toHaveLength(2);
});
test("concurrent override retries create one revision; stale/different payload requests are rejected", async () => {
  const key = randomUUID(); expect(await Promise.all([override(64000, 0, key), override(64000, 0, key)])).toEqual([expect.objectContaining({ revision: 1 }), expect.objectContaining({ revision: 1 })]);
  await expect(override(66000, 0, key)).rejects.toThrow("другими данными");
  await expect(override(66000)).rejects.toThrow("уже изменена");
});
test("offer snapshots server-calculated standard total and human agreed price with approval and audit", async () => {
  await override(65000); const input = await offer();
  const result = await actions.saveOffer(input, randomUUID());
  const workspace = await queries.getOfferWorkspace(clientId);
  expect(workspace.revisions).toHaveLength(1);
  expect(workspace.revisions[0]).toMatchObject({ id: result.revisionId, standardTotalCents: 100000, agreedTotalCents: 85000, discountCents: 15000, approvedById: actor, reason: input.reason });
  expect(workspace.revisions[0].items.find(row => row.masterId === masterId)?.priceSnapshot).toMatchObject({ source: "master_override", priceCents: 65000, humanQuoted: false });
  expect(await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.studioId, studioId), eq(s.auditLogs.action, "offer_created")))).toHaveLength(1);
});
test("offer retry after lost response is idempotent; revision appends and competing old revision fails", async () => {
  const input = await offer(), key = randomUUID();
  const [first, retry] = await Promise.all([actions.saveOffer(input, key), actions.saveOffer(input, key)]); expect(first).toEqual(retry);
  const next = { ...input, offerId: first.offerId, expectedRevision: 1, agreedTotalCents: 80000, reason: "Revised approval" };
  await actions.saveOffer(next, randomUUID());
  await expect(actions.saveOffer(next, randomUUID())).rejects.toThrow("уже изменено");
  expect((await queries.getOfferWorkspace(clientId)).revisions.map(row => row.agreedTotalCents).sort()).toEqual([80000, 85000]);
});
test("later base/override changes leave recorded offer and appointment snapshots untouched", async () => {
  const first = await actions.saveOffer(await offer(), randomUUID());
  const [appointment] = await db.insert(s.appointments).values({ studioId, clientId, masterId, serviceId: serviceId("brows-hair"), startAt: new Date(), endAt: new Date(Date.now() + 7200000), priceSnapshotCents: 60000, serviceSnapshot: { name: "Original service" }, clientSnapshot: {}, masterSnapshot: {}, durationSnapshotMinutes: 120, source: "other", createdById: actor }).returning();
  const before = (await queries.getOfferWorkspace(clientId)).revisions[0]; await override(70000);
  await db.update(s.services).set({ priceCents: 71000 }).where(eq(s.services.id, serviceId("brows-hair")));
  expect((await queries.getOfferWorkspace(clientId)).revisions[0]).toEqual(before);
  expect((await db.select().from(s.appointments).where(eq(s.appointments.id, appointment.id)))[0]).toEqual(appointment);
  expect(first.revision).toBe(1);
});
test("price change after preview fails rather than silently approving a new total", async () => {
  const input = await offer(); await override(70000);
  await expect(actions.saveOffer(input, randomUUID())).rejects.toThrow("Цена изменилась");
  expect((await queries.getOfferWorkspace(clientId)).offers).toHaveLength(0);
});
test("estimate/range/quote require explicit human standard price; fixed price cannot be forged", async () => {
  const input = await offer(), lips = await price("lips");
  input.items[1] = { serviceId: lips.serviceId, masterId: null, priceVersion: lips.version, standardCents: null };
  await expect(actions.saveOffer(input, randomUUID())).rejects.toThrow("подтверждённую");
  input.items[1].standardCents = 53000;
  await actions.saveOffer(input, randomUUID());
  expect((await queries.getOfferWorkspace(clientId)).revisions[0].standardTotalCents).toBe(113000);
  const forged = await offer(); forged.items[0].standardCents = 1;
  await expect(actions.saveOffer(forged, randomUUID())).rejects.toThrow("сервером");
});
test("same-zone, non-PMU, invalid cents and overflow totals are rejected", async () => {
  const input = await offer(); input.items[1] = input.items[0];
  await expect(actions.saveOffer(input, randomUUID())).rejects.toThrow("разные зоны");
  const remover = await price("remover"); input.items[1] = { serviceId: remover.serviceId, masterId: null, standardCents: null, priceVersion: remover.version };
  await expect(actions.saveOffer(input, randomUUID())).rejects.toThrow("нескольких зон");
  await expect(actions.saveOffer({ ...await offer(), agreedTotalCents: 0.5 }, randomUUID())).rejects.toThrow();
  await expect(actions.saveOffer({ ...await offer(), reason: " " }, randomUUID())).rejects.toThrow();
  await override(2147483647); await expect(actions.saveOffer(await offer(), randomUUID())).rejects.toThrow();
});
test("foreign client/service/master references and archived clients fail closed", async () => {
  await expect(actions.saveOffer({ ...await offer(), clientId: foreignClient }, randomUUID())).rejects.toThrow("Client not found");
  const [foreignMaster] = await db.insert(s.masters).values({ studioId: foreignStudio, displayName: "Foreign" }).returning();
  await expect(actions.saveMasterPrice({ serviceId: serviceId("brows-hair"), masterId: foreignMaster.id, priceCents: 1, expectedRevision: 0, reason: "invalid tenant" }, randomUUID())).rejects.toThrow("Мастер недоступен");
  await db.update(s.clients).set({ deletedAt: new Date() }).where(eq(s.clients.id, clientId));
  await expect(actions.saveOffer(await offer(), randomUUID())).rejects.toThrow("Client not found");
  await expect(queries.getOfferWorkspace(foreignClient)).rejects.toThrow("Client not found");
});
test("Master and AI cannot create offers or modify prices, including retries and injected approvals", async () => {
  const input = await offer(), key = randomUUID(); await actions.saveOffer(input, key);
  for (const code of ["MASTER", "AI_SYSTEM"]) {
    await role(code);
    await expect(actions.saveOffer(input, key)).rejects.toThrow("Permission denied");
    await expect(override(1)).rejects.toThrow("Permission denied");
    await expect(queries.getOfferWorkspace(clientId)).rejects.toThrow("Permission denied");
  }
  await role("OWNER"); await expect(actions.saveOffer({ ...input, approvedById: "forged" } as OfferInput, randomUUID())).rejects.toThrow();
});
test("Admin can approve offers but cannot modify catalog/master prices; deny override is respected", async () => {
  const input = await offer(); await role("ADMIN");
  expect((await actions.saveOffer(input, randomUUID())).revision).toBe(1);
  await expect(override(1)).rejects.toThrow("Permission denied");
  const [permission] = await db.select().from(s.permissions).where(eq(s.permissions.code, "OFFER_MANAGE"));
  await db.insert(s.userCustomPermissions).values({ studioId, userId: actor, permissionId: permission.id, effect: "deny" });
  await expect(actions.saveOffer(input, randomUUID())).rejects.toThrow("Permission denied");
});
test("recorded header, revisions and line items cannot be updated/deleted directly", async () => {
  const saved = await actions.saveOffer(await offer(), randomUUID()); await override(65000);
  await expect(db.update(s.offerRevisions).set({ reason: "tampered" }).where(eq(s.offerRevisions.id, saved.revisionId))).rejects.toThrow();
  await expect(db.delete(s.offerItems).where(eq(s.offerItems.revisionId, saved.revisionId))).rejects.toThrow();
  await expect(db.update(s.customOffers).set({ clientId: foreignClient }).where(eq(s.customOffers.id, saved.offerId))).rejects.toThrow();
  await expect(db.update(s.masterPriceRevisions).set({ priceCents: 1 }).where(eq(s.masterPriceRevisions.studioId, studioId))).rejects.toThrow();
});
test("audit failure rolls back offer header/items/receipt and master price revision", async () => {
  await db.execute(sql`alter table audit_logs add constraint reject_price_audit_test check (action not in ('offer_created', 'master_price_changed'))`);
  try {
    await expect(actions.saveOffer(await offer(), randomUUID())).rejects.toThrow(); await expect(override(65000)).rejects.toThrow();
    expect(await db.select().from(s.customOffers).where(eq(s.customOffers.studioId, studioId))).toHaveLength(0);
    expect(await db.select().from(s.masterPriceRevisions).where(eq(s.masterPriceRevisions.studioId, studioId))).toHaveLength(0);
    expect(await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId))).toHaveLength(0);
  } finally { await db.execute(sql`alter table audit_logs drop constraint reject_price_audit_test`); }
});
test("base price changes require user reason; unrelated edits do not", async () => {
  const row = serviceRows.find(row => row.catalogCode === "brows-hair")!;
  const input = { catalogCode: "brows-hair", priceMode: "fixed" as const, price: 601, priceMax: null, durationMinutes: 120, preparationTemplateId: null, postCareTemplateId: null, isActive: true };
  await expect(catalog.updateServiceAction(row.id, input)).rejects.toThrow();
  await catalog.updateServiceAction(row.id, { ...input, priceChangeReason: "Approved catalog update" });
  const [audit] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.studioId, studioId), eq(s.auditLogs.action, "service_updated")));
  expect(audit).toMatchObject({ reason: "Approved catalog update", reasonSource: "user" });
});
test("quote-only base and zero master override are distinct; removing eligibility never destroys override history", async () => {
  const lipsId = serviceId("lips"); await db.update(s.services).set({ priceMode: "master_quote", priceCents: null, priceMaxCents: null }).where(eq(s.services.id, lipsId));
  const quote = await price("lips"); expect(quote.priceCents).toBeNull();
  const input = await offer(); input.items[1] = { serviceId: lipsId, masterId: null, standardCents: 55500, priceVersion: quote.version };
  await actions.saveOffer(input, randomUUID());
  expect((await queries.getOfferWorkspace(clientId)).revisions[0].standardTotalCents).toBe(115500);
  await override(0); expect(await price("brows-hair", masterId)).toMatchObject({ source: "master_override", priceCents: 0 });
  await db.delete(s.masterServices).where(and(eq(s.masterServices.masterId, masterId), eq(s.masterServices.serviceId, serviceId("brows-hair"))));
  await expect(price("brows-hair", masterId)).rejects.toThrow("Мастер недоступен");
  await db.insert(s.masterServices).values({ studioId, masterId, serviceId: serviceId("brows-hair") });
  expect(await price("brows-hair", masterId)).toMatchObject({ overrideRevision: 1, priceCents: 0 });
});
test("offer read logging is fail-closed and logs IDs without offer amounts", async () => {
  await actions.saveOffer(await offer(), randomUUID()); await queries.getOfferWorkspace(clientId);
  const [entry] = await db.select().from(s.accessLogs).where(and(eq(s.accessLogs.studioId, studioId), eq(s.accessLogs.operation, "offers.read")));
  expect(entry).toMatchObject({ recordCount: 1, result: "returned" }); expect(JSON.stringify(entry)).not.toContain("85000");
  await db.execute(sql`alter table access_logs add constraint reject_offer_read_test check (operation != 'offers.read') not valid`);
  try { await expect(queries.getOfferWorkspace(clientId)).rejects.toThrow("Access logging unavailable"); }
  finally { await db.execute(sql`alter table access_logs drop constraint reject_offer_read_test`); }
});
test("database seals line insertion with the revision and validates multi-zone totals at commit", async () => {
  const result = await actions.saveOffer(await offer(), randomUUID());
  const [item] = await db.select().from(s.offerItems).where(eq(s.offerItems.revisionId, result.revisionId));
  await expect(db.insert(s.offerItems).values({ ...item, id: randomUUID(), zoneCode: "lips", serviceId: serviceId("lips"), standardCents: 0 })).rejects.toThrow();
  await expect(db.transaction(async tx => {
    const [revision] = await tx.insert(s.offerRevisions).values({ studioId, offerId: result.offerId, revision: 2, standardTotalCents: 1, agreedTotalCents: 0, discountCents: 1, reason: "Malformed total", approvedById: actor }).returning();
    await tx.insert(s.offerItems).values([
      { ...item, id: randomUUID(), revisionId: revision.id, standardCents: 10 },
      { ...item, id: randomUUID(), revisionId: revision.id, zoneCode: "eyes", serviceId: serviceId("eyes-lashline"), standardCents: 10 },
    ]);
  })).rejects.toThrow();
  expect((await queries.getOfferWorkspace(clientId)).revisions).toHaveLength(1);
});
