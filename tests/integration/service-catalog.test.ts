import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { CATALOG_DEFINITIONS } from "@/features/services/catalog";
import { serviceSchema, type ServiceSchema } from "@/features/services/schemas/service.schema";
import { servicePriceLabel } from "@/features/services/price-label";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let actions: typeof import("@/features/services/server/actions"), queries: typeof import("@/features/services/server/queries");
const owner = randomUUID(); let studioId: string, foreignStudio: string, ownerRole: string, masterRole: string;
const input: ServiceSchema = { priceChangeReason: "Synthetic price review", catalogCode: "brows-shading", priceMode: "estimate", price: 500, priceMax: null, durationMinutes: 120,
  preparationTemplateId: null, postCareTemplateId: null, isActive: true };
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  actions = await import("@/features/services/server/actions"); queries = await import("@/features/services/server/queries");
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(row => row.id);
  await db.insert(s.user).values({ id: owner, name: "Synthetic", email: `${owner}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  const roles = await db.select().from(s.roles); ownerRole = roles.find(row => row.code === "OWNER")!.id; masterRole = roles.find(row => row.code === "MASTER")!.id;
  await db.insert(s.studioMembers).values({ studioId, userId: owner, roleId: ownerRole });
});
beforeEach(async () => {
  session.id = owner;
  await db.update(s.studioMembers).set({ roleId: ownerRole }).where(eq(s.studioMembers.userId, owner));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
  await db.delete(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId));
  await db.delete(s.appointments).where(eq(s.appointments.studioId, studioId));
  await db.delete(s.services).where(eq(s.services.studioId, studioId));
});
afterAll(async () => {
  if (!database) return;
  try { await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.studios).where(eq(s.studios.id, foreignStudio)); await db.delete(s.user).where(eq(s.user.id, owner)); }
  finally { await database.close(); }
});
async function service(id: string) { return (await db.select().from(s.services).where(eq(s.services.id, id)))[0]; }
async function legacy() {
  return (await db.insert(s.services).values({ studioId, name: "Legacy brows", category: "brows", procedureType: "brows", durationMinutes: 150, priceCents: 35000, bufferBeforeMinutes: 10 }).returning())[0];
}
test("migration supplies the complete 13-service reference with normative prices/session models and no invented timings", async () => {
  const rows = await db.select().from(s.serviceDefinitions);
  expect(rows).toHaveLength(13);
  for (const entry of CATALOG_DEFINITIONS) expect(rows.find(row => row.code === entry.code)).toEqual(entry);
  expect(rows.filter(row => row.categoryCode === "pmu").every(row => row.sessionsModel === "two" && row.durationMinutes === 120)).toBe(true);
  expect(rows.find(row => row.code === "remover")).toMatchObject({ sessionsModel: "variable", priceCents: 10000, durationMinutes: 60 });
  expect(rows.filter(row => row.durationMinutes === null)).toHaveLength(4);
});
test("catalog import repeats without changing edited prices, archive state or legacy IDs", async () => {
  const old = await legacy(); expect(await actions.importPhase3Catalog()).toMatchObject({ created: 13 });
  const [first] = await db.select().from(s.services).where(and(eq(s.services.studioId, studioId), eq(s.services.catalogCode, "brows-shading")));
  await actions.updateServiceAction(first.id, { ...input, price: 510 }); await actions.archiveServiceAction(first.id);
  expect(await actions.importPhase3Catalog()).toMatchObject({ created: 0 });
  expect(await service(first.id)).toMatchObject({ priceCents: 51000, isActive: false });
  expect(await service(old.id)).toEqual(old);
  expect(await db.select().from(s.services).where(eq(s.services.studioId, studioId))).toHaveLength(14);
  expect((await queries.getBookableServices(studioId)).some(row => row.id === old.id)).toBe(false);
});
test("service creation is idempotent; a second key cannot duplicate a catalog entry, even archived", async () => {
  const key = randomUUID(); const results = await Promise.all([actions.createServiceAction(input, key), actions.createServiceAction(input, key)]);
  expect(results[0]).toEqual(results[1]);
  await expect(actions.createServiceAction(input, randomUUID())).rejects.toThrow("уже есть");
  await actions.archiveServiceAction(results[0].id);
  await expect(actions.createServiceAction(input, randomUUID())).rejects.toThrow("уже есть");
  await actions.restoreServiceAction(results[0].id); expect((await service(results[0].id)).isActive).toBe(true);
});
test("unknown/free-text catalog fields, invalid cents, fractional duration and wrong PMU duration are rejected", async () => {
  for (const data of [{ ...input, price: 500.001 }, { ...input, durationMinutes: 120.5 }, { ...input, name: "Free text" }, { ...input, bufferBeforeMinutes: 10 }, { ...input, priceMode: "range", priceMax: 400 }]) expect(serviceSchema.safeParse(data).success).toBe(false);
  await expect(actions.createServiceAction({ ...input, catalogCode: "anything" }, randomUUID())).rejects.toThrow("справочника");
  await expect(actions.createServiceAction({ ...input, durationMinutes: 60 }, randomUUID())).rejects.toThrow("120");
});
test("nullable price is a human quote, ranges stay estimates, and missing duration prevents activation", async () => {
  const quote = await actions.createServiceAction({ ...input, priceMode: "master_quote", price: null }, randomUUID());
  expect(await service(quote.id)).toMatchObject({ priceCents: null, priceMaxCents: null });
  expect(servicePriceLabel(await service(quote.id))).toBe("Цена определяется мастером");
  expect(servicePriceLabel({ priceMode: "range", priceCents: 45000, priceMaxCents: 50000 })).toMatch(/^Ориентир/);
  expect(serviceSchema.safeParse({ ...input, catalogCode: "skin-korean", durationMinutes: null }).success).toBe(false);
  const skin = await actions.createServiceAction({ ...input, catalogCode: "skin-korean", durationMinutes: null, isActive: false }, randomUUID());
  await actions.archiveServiceAction(skin.id); await actions.restoreServiceAction(skin.id);
  expect(await service(skin.id)).toMatchObject({ isActive: false, deletedAt: null, durationMinutes: null });
});
test("database enforces dictionary FK, definition/session consistency and zero buffers", async () => {
  const { id } = await actions.createServiceAction(input, randomUUID());
  await expect(db.update(s.services).set({ sessionsModel: "one" }).where(eq(s.services.id, id))).rejects.toThrow();
  await expect(db.update(s.services).set({ bufferAfterMinutes: 10 }).where(eq(s.services.id, id))).rejects.toThrow();
  await expect(db.update(s.services).set({ catalogCode: "unknown" }).where(eq(s.services.id, id))).rejects.toThrow();
  await expect(db.update(s.serviceDefinitions).set({ techniqueCode: "unknown" }).where(eq(s.serviceDefinitions.code, "brows-shading"))).rejects.toThrow();
});
test("template references check active kind and studio both server-side and at DB FK", async () => {
  const [own, foreign, wrongKind] = await db.insert(s.whatsappTemplates).values([
    { studioId, name: "Preparation", category: "preparation", body: "Synthetic" },
    { studioId: foreignStudio, name: "Foreign", category: "preparation", body: "Synthetic" },
    { studioId, name: "Other", category: "post_care", body: "Synthetic" },
  ]).returning();
  await expect(actions.createServiceAction({ ...input, preparationTemplateId: foreign.id }, randomUUID())).rejects.toThrow("Шаблон");
  await expect(actions.createServiceAction({ ...input, preparationTemplateId: wrongKind.id }, randomUUID())).rejects.toThrow("Шаблон");
  const { id } = await actions.createServiceAction({ ...input, preparationTemplateId: own.id }, randomUUID());
  await expect(db.update(s.services).set({ preparationTemplateId: foreign.id }).where(eq(s.services.id, id))).rejects.toThrow();
  await db.update(s.whatsappTemplates).set({ isActive: false }).where(eq(s.whatsappTemplates.id, own.id));
  await expect(actions.updateServiceAction(id, { ...input, preparationTemplateId: own.id })).rejects.toThrow("Шаблон");
});
test("consolidation preserves legacy visit references and snapshots, copies master eligibility and is repeat-safe", async () => {
  const old = await legacy(), target = await actions.createServiceAction(input, randomUUID());
  const [master] = await db.insert(s.masters).values({ studioId, displayName: "Synthetic" }).returning();
  const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();
  await db.insert(s.masterServices).values({ studioId, masterId: master.id, serviceId: old.id });
  const [visit] = await db.insert(s.appointments).values({ studioId, clientId: client.id, masterId: master.id, serviceId: old.id,
    startAt: new Date("2026-10-10T10:00Z"), endAt: new Date("2026-10-10T12:30Z"), source: "other", createdById: owner,
    serviceSnapshot: { name: old.name }, clientSnapshot: {}, masterSnapshot: {}, priceSnapshotCents: 35000, durationSnapshotMinutes: 150 }).returning();
  const data = { canonicalId: target.id, duplicateIds: [old.id], reason: "Owner confirms identical service" };
  await actions.consolidateServices(data); await actions.consolidateServices(data);
  expect(await service(old.id)).toMatchObject({ supersededById: target.id, isActive: false, priceCents: 35000, durationMinutes: 150 });
  expect((await db.select().from(s.appointments).where(eq(s.appointments.id, visit.id)))[0]).toEqual(visit);
  expect(await db.select().from(s.masterServices).where(eq(s.masterServices.masterId, master.id))).toHaveLength(2);
  expect(await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, old.id), eq(s.auditLogs.action, "service_consolidated")))).toHaveLength(1);
  await expect(actions.restoreServiceAction(old.id)).rejects.toThrow();
});
test("legacy adoption preserves ID; audit failure rolls back duplicate archive and master links", async () => {
  const old = await legacy(); await actions.updateServiceAction(old.id, input);
  expect(await service(old.id)).toMatchObject({ catalogVersion: 1, catalogCode: "brows-shading", bufferBeforeMinutes: 0 });
  const duplicate = await legacy();
  await db.execute(sql`create or replace function reject_catalog_audit() returns trigger language plpgsql as $$ begin raise exception 'audit failure'; end $$`);
  await db.execute(sql`create trigger reject_catalog_audit before insert on audit_logs for each row execute function reject_catalog_audit()`);
  try { await expect(actions.consolidateServices({ canonicalId: old.id, duplicateIds: [duplicate.id], reason: "Synthetic" })).rejects.toThrow(); }
  finally { await db.execute(sql`drop trigger reject_catalog_audit on audit_logs`); await db.execute(sql`drop function reject_catalog_audit()`); }
  expect(await service(duplicate.id)).toEqual(duplicate);
});
test("Master is read-only and a foreign service cannot be consolidated", async () => {
  const target = await actions.createServiceAction(input, randomUUID());
  const [foreign] = await db.insert(s.services).values({ studioId: foreignStudio, name: "Foreign", category: "brows", procedureType: "brows", priceCents: 10000, durationMinutes: 120 }).returning();
  await expect(actions.consolidateServices({ canonicalId: target.id, duplicateIds: [foreign.id], reason: "Invalid tenant" })).rejects.toThrow("Service not found");
  await db.update(s.studioMembers).set({ roleId: masterRole }).where(eq(s.studioMembers.userId, owner));
  expect((await queries.getCatalogOptions(studioId)).definitions).toHaveLength(13);
  await expect(actions.importPhase3Catalog()).rejects.toThrow("Permission denied");
  await expect(actions.createServiceAction(input, randomUUID())).rejects.toThrow("Permission denied");
  await expect(actions.updateServiceAction(target.id, input)).rejects.toThrow("Permission denied");
});

test("opt-in seed uses the same catalog initializer and preserves edits on repeat", async () => {
  const { seedDatabase } = await import("@/db/seed-core");
  const [studio] = await db.select().from(s.studios).where(eq(s.studios.id, studioId));
  const settings = { SEED_STUDIO_NAME: studio.name, SEED_STUDIO_SLUG: studio.slug, SEED_STUDIO_TIMEZONE: "Europe/Rome", SEED_STUDIO_COUNTRY: "Italy", SEED_STUDIO_CITY: "Test",
    SEED_STUDIO_ADDRESS: "", SEED_STUDIO_WHATSAPP: "", SEED_ADMIN_EMAIL: `${owner}@example.test`, SEED_DEMO_SERVICES: "false" as const, SEED_PHASE3_CATALOG: "true" as const };
  await seedDatabase(settings);
  const rows = await db.select().from(s.services).where(eq(s.services.studioId, studioId)); expect(rows).toHaveLength(13);
  const first = rows.find(row => row.catalogCode === "brows-shading")!;
  await actions.updateServiceAction(first.id, { ...input, price: 512.34 }); await seedDatabase(settings);
  expect(await service(first.id)).toMatchObject({ priceCents: 51234 });
  expect(await db.select().from(s.services).where(eq(s.services.studioId, studioId))).toHaveLength(13);
});
