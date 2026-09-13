import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import * as s from "@/db/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let seed: typeof import("@/db/seed-core").seedDatabase;
const slug = `seed-${randomUUID()}`;
const settings = { SEED_STUDIO_NAME: "Synthetic", SEED_STUDIO_SLUG: slug,
  SEED_STUDIO_TIMEZONE: "Europe/Rome", SEED_STUDIO_COUNTRY: "Italy", SEED_STUDIO_CITY: "Test",
  SEED_STUDIO_ADDRESS: "", SEED_STUDIO_WHATSAPP: "", SEED_ADMIN_EMAIL: `${slug}@example.test`,
  SEED_DEMO_SERVICES: "false" as "true" | "false" };
let initialRoles: string[], initialPermissions: string[];
beforeAll(async () => {
  database = await createTestDatabase();
  initialRoles = (await database.db.select().from(s.roles)).map(r => r.id);
  initialPermissions = (await database.db.select().from(s.permissions)).map(r => r.id);
  vi.doMock("@/db", () => ({ db: database.db }));
  seed = (await import("@/db/seed-core")).seedDatabase;
});
afterAll(async () => {
  if (!database) return;
  try {
    await database.db.delete(s.studios).where(eq(s.studios.slug, slug));
    const roles = (await database.db.select().from(s.roles)).filter(r => !initialRoles.includes(r.id));
    const permissions = (await database.db.select().from(s.permissions)).filter(r => !initialPermissions.includes(r.id));
    if (roles.length) await database.db.delete(s.roles).where(inArray(s.roles.id, roles.map(r => r.id)));
    if (permissions.length) await database.db.delete(s.permissions).where(inArray(s.permissions.id, permissions.map(r => r.id)));
  } finally { await database.close(); }
});
test("seed repeats without duplicates and preserves edited studio and demo records", async () => {
  const first = await seed(settings);
  expect(first.adminLinked).toBe(false);
  expect(await database.db.select().from(s.services).where(eq(s.services.studioId, first.studioId))).toHaveLength(0);
  const grants = await database.db.select().from(s.rolePermissions);
  await database.db.update(s.studios).set({ name: "Edited" }).where(eq(s.studios.id, first.studioId));
  await seed(settings);
  expect(await database.db.select().from(s.rolePermissions)).toHaveLength(grants.length);
  expect((await database.db.select().from(s.studios).where(eq(s.studios.id, first.studioId)))[0].name).toBe("Edited");
  const demoSettings = { ...settings, SEED_DEMO_SERVICES: "true" as const };
  await seed(demoSettings);
  const services = await database.db.select().from(s.services).where(eq(s.services.studioId, first.studioId));
  expect(services).toHaveLength(3);
  await database.db.update(s.services).set({ name: "Renamed", priceCents: 12345, isActive: false }).where(eq(s.services.id, services[0].id));
  await seed(demoSettings);
  const repeated = await database.db.select().from(s.services).where(eq(s.services.studioId, first.studioId));
  expect(repeated).toHaveLength(3);
  expect(repeated.find(r => r.id === services[0].id)).toMatchObject({ name: "Renamed", priceCents: 12345, isActive: false });
});

test("legacy demo rows are adopted without changing identity or price; ambiguity rolls back", async () => {
  const { demoServices } = await import("@/db/seed-core");
  const [studio] = await database.db.select().from(s.studios).where(eq(s.studios.slug, slug));
  await database.db.delete(s.services).where(eq(s.services.studioId, studio.id));
  const [legacy] = await database.db.insert(s.services).values({ ...demoServices[0], seedKey: null, studioId: studio.id, priceCents: 77777 }).returning();
  await seed({ ...settings, SEED_DEMO_SERVICES: "true" });
  expect((await database.db.select().from(s.services).where(eq(s.services.id, legacy.id)))[0]).toMatchObject({ seedKey: demoServices[0].seedKey, priceCents: 77777 });
  await database.db.delete(s.services).where(eq(s.services.studioId, studio.id));
  await database.db.insert(s.services).values([demoServices[1], demoServices[1]].map(demo => ({ ...demo, seedKey: null, studioId: studio.id })));
  await expect(seed({ ...settings, SEED_DEMO_SERVICES: "true" })).rejects.toThrow("Ambiguous");
  const after = await database.db.select().from(s.services).where(eq(s.services.studioId, studio.id));
  expect(after).toHaveLength(2);
  expect(after.every(service => service.seedKey === null)).toBe(true);
});

test("seed links a registered admin once and does not reactivate an existing membership", async () => {
  const id = randomUUID();
  await database.db.insert(s.user).values({ id, name: "Synthetic", email: settings.SEED_ADMIN_EMAIL, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  try {
    const result = await seed(settings);
    expect(result.adminLinked).toBe(true);
    const [member] = await database.db.select().from(s.studioMembers).where(eq(s.studioMembers.userId, id));
    await database.db.update(s.studioMembers).set({ isActive: false }).where(eq(s.studioMembers.id, member.id));
    await seed(settings);
    const memberships = await database.db.select().from(s.studioMembers).where(eq(s.studioMembers.userId, id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].isActive).toBe(false);
  } finally { await database.db.delete(s.user).where(eq(s.user.id, id)); }
});
