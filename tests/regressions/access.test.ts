import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as schema from "@/db/schema";
import { hasPermission } from "@/lib/permissions";

const state = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: {
  getSession: vi.fn(async () => state.userId ? { user: { id: state.userId } } : null),
} } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let actions: typeof import("@/features/auth/server/actions");
let search: typeof import("@/features/search/server/actions");
let queries: typeof import("@/features/clients/server/queries");
let serviceQueries: typeof import("@/features/services/server/queries");
let masterQueries: typeof import("@/features/masters/server/queries");
let studioQueries: typeof import("@/features/studios/server/queries");
let mediaActions: typeof import("@/features/media/server/actions");
const userId = randomUUID();
const outsider = randomUUID();
let studioId: string, foreignStudioId: string, clientId: string, foreignClientId: string, roleId: string;
const createdPermissions: string[] = [];
const permissionIds = new Map<string, string>();
const codes = ["CLIENT_READ", "SERVICE_READ", "MASTER_READ", "MEDICAL_PROFILE_READ", "MEDIA_READ", "CONSENT_READ"];

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  vi.doMock("@/db", () => ({ db }));
  actions = await import("@/features/auth/server/actions");
  search = await import("@/features/search/server/actions");
  queries = await import("@/features/clients/server/queries");
  serviceQueries = await import("@/features/services/server/queries");
  masterQueries = await import("@/features/masters/server/queries");
  studioQueries = await import("@/features/studios/server/queries");
  mediaActions = await import("@/features/media/server/actions");
  const studios = await db.insert(schema.studios).values([studioFixture(), studioFixture()]).returning();
  [studioId, foreignStudioId] = studios.map((s) => s.id);
  await db.insert(schema.user).values([userId, outsider].map((id) => ({
    id, name: "Synthetic Access User", email: `${id}@example.test`,
    emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
  })));
  [roleId] = (await db.insert(schema.roles).values({ code: `TEST_${randomUUID()}`, name: "Test reader" }).returning()).map((r) => r.id);
  await db.insert(schema.studioMembers).values({ userId, studioId, roleId });
  const added = await db.insert(schema.permissions).values(codes.map((code) => ({ code, name: code }))).onConflictDoNothing().returning();
  createdPermissions.push(...added.map((p) => p.id));
  for (const p of await db.select().from(schema.permissions).where(inArray(schema.permissions.code, codes))) permissionIds.set(p.code, p.id);
  await db.insert(schema.rolePermissions).values([...permissionIds.values()].map((permissionId) => ({ roleId, permissionId })));
  const clients = await db.insert(schema.clients).values([clientFixture(studioId), clientFixture(foreignStudioId)]).returning();
  [clientId, foreignClientId] = clients.map((c) => c.id);
  await db.insert(schema.clientMedicalProfiles).values([
    { clientId, medicalNotes: "Synthetic private note" },
    { clientId: foreignClientId, medicalNotes: "Foreign private note" },
  ]);
  await db.insert(schema.media).values([
    { studioId, clientId, type: "before", url: "https://example.test/photo", createdById: userId },
    { studioId, clientId, type: "consent", url: "https://example.test/consent", createdById: userId },
  ]);
  await db.insert(schema.activityEvents).values([
    { studioId, clientId, type: "client_created", title: "Client created" },
    { studioId, clientId, type: "medical_profile_updated", title: "Synthetic sensitive history" },
  ]);
});

beforeEach(async () => {
  state.userId = userId;
  await database.db.delete(schema.userCustomPermissions).where(eq(schema.userCustomPermissions.userId, userId));
  await database.db.update(schema.studioMembers).set({ isActive: true }).where(eq(schema.studioMembers.userId, userId));
  await database.db.update(schema.studios).set({ isActive: true }).where(eq(schema.studios.id, studioId));
});

afterAll(async () => {
  if (!database) return;
  try {
    await database.db.delete(schema.user).where(inArray(schema.user.id, [userId, outsider]));
    if (studioId) await database.db.delete(schema.studios).where(inArray(schema.studios.id, [studioId, foreignStudioId]));
    if (roleId) await database.db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    if (createdPermissions.length) await database.db.delete(schema.permissions).where(inArray(schema.permissions.id, createdPermissions));
  } finally { await database.close(); }
});

async function override(code: string, effect: "allow" | "deny") {
  await database.db.insert(schema.userCustomPermissions).values({
    userId, studioId, permissionId: permissionIds.get(code)!, effect,
  });
}

test("P0-ACCESS-01: non-member receives no fallback studio", async () => {
  state.userId = outsider;
  expect(await actions.getCurrentStudioId(outsider)).toBeUndefined();
  await expect(search.searchClientsAction(studioId, "Synthetic")).rejects.toThrow("Permission denied");
});

test("P0-ACCESS-02: unauthenticated direct search is rejected", async () => {
  state.userId = null;
  await expect(search.searchClientsAction(studioId, "Synthetic")).rejects.toThrow("Unauthorized");
  await expect(search.globalSearchAction(studioId, "")).rejects.toThrow("Unauthorized");
});

test("active member can read own studio, search and medical profile", async () => {
  expect(await actions.getCurrentStudioId(userId)).toBe(studioId);
  expect((await queries.getClients(studioId)).map((c) => c.id)).toEqual([clientId]);
  expect((await search.searchClientsAction(studioId, "Synthetic")).map((c) => c.id)).toEqual([clientId]);
  expect((await search.globalSearchAction(studioId, "Synthetic")).clients.map((c) => c.id)).toEqual([clientId]);
  expect((await queries.getClientMedicalProfile(clientId, studioId))?.medicalNotes).toBe("Synthetic private note");
});

test("caller cannot impersonate another user or choose a foreign studio", async () => {
  expect(await actions.getCurrentStudioId(outsider)).toBeUndefined();
  await expect(search.searchClientsAction(foreignStudioId, "Synthetic")).rejects.toThrow("Permission denied");
  await expect(search.globalSearchAction(foreignStudioId, "Synthetic")).rejects.toThrow("Permission denied");
  await expect(search.searchClientsAction("invalid-id", "Synthetic")).rejects.toThrow("Permission denied");
});

test("inactive membership blocks context and reads", async () => {
  await database.db.update(schema.studioMembers).set({ isActive: false }).where(eq(schema.studioMembers.userId, userId));
  expect(await actions.getCurrentStudioId(userId)).toBeUndefined();
  await expect(queries.getClients(studioId)).rejects.toThrow("Permission denied");
});

test("inactive studio blocks context even with an active membership", async () => {
  await database.db.update(schema.studios).set({ isActive: false }).where(eq(schema.studios.id, studioId));
  expect(await actions.getCurrentStudioId(userId)).toBeUndefined();
  await expect(queries.getClients(studioId)).rejects.toThrow("Permission denied");
});

test("all query entrypoints reject foreign studio", async () => {
  for (const read of [queries.getClients, serviceQueries.getServices, serviceQueries.getActiveServices,
    masterQueries.getMasters, masterQueries.getActiveMasters, studioQueries.getStudioById]) {
    await expect(read(foreignStudioId)).rejects.toThrow("Permission denied");
  }
});

test("foreign client ID returns neither client, medical profile nor activity", async () => {
  expect(await queries.getClientById(foreignClientId, studioId)).toBeUndefined();
  expect(await queries.getClientMedicalProfile(foreignClientId, studioId)).toBeUndefined();
  expect(await queries.getClientActivity(foreignClientId, studioId)).toEqual([]);
  expect(await mediaActions.getClientMediaAction(foreignClientId)).toEqual([]);
});

test("medical deny is enforced even when an unrelated allow was inserted first", async () => {
  await override("CLIENT_READ", "allow");
  await override("MEDICAL_PROFILE_READ", "deny");
  expect(await hasPermission(database.db, userId, studioId, "CLIENT_READ")).toBe(true);
  expect(await hasPermission(database.db, userId, studioId, "MEDICAL_PROFILE_READ")).toBe(false);
  await expect(queries.getClientMedicalProfile(clientId, studioId)).rejects.toThrow("Permission denied");
});

test("duplicate override is rejected and existing deny remains effective", async () => {
  await override("CLIENT_READ", "deny");
  await expect(override("CLIENT_READ", "allow")).rejects.toThrow();
  await expect(queries.getClients(studioId)).rejects.toThrow("Permission denied");
});

test("global search omits categories without read permission", async () => {
  await override("CLIENT_READ", "deny");
  expect((await search.globalSearchAction(studioId, "Synthetic")).clients).toEqual([]);
  await expect(search.searchClientsAction(studioId, "Synthetic")).rejects.toThrow("Permission denied");
});

test("consent read cannot be bypassed via generic media action", async () => {
  await override("CONSENT_READ", "deny");
  await expect(mediaActions.getClientMediaAction(clientId, "consent")).rejects.toThrow("Permission denied");
  expect((await mediaActions.getClientMediaAction(clientId, "media")).map((m) => m.type)).toEqual(["before"]);
});


test("medical history is excluded when medical read is denied", async () => {
  expect(await queries.getClientActivity(clientId, studioId)).toHaveLength(2);
  await override("MEDICAL_PROFILE_READ", "deny");
  expect((await queries.getClientActivity(clientId, studioId)).map((e) => e.type)).toEqual(["client_created"]);
});

test("authorized consent reader receives only consent files", async () => {
  expect((await mediaActions.getClientMediaAction(clientId, "consent")).map((m) => m.type)).toEqual(["consent"]);
});
