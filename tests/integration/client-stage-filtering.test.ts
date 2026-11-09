import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { CYCLE_STAGES } from "@/features/treatment-cycles/schemas/cycle.schema";

const session = vi.hoisted(() => ({ id: "", studioId: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "pmu_active_studio" && session.studioId ? { value: session.studioId } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let clientQueries: typeof import("@/features/clients/server/queries");
let cycleActions: typeof import("@/features/treatment-cycles/server/actions");
let reviewActions: typeof import("@/features/treatment-cycles/server/review");

let studioId: string, roleIds: Record<string, string>;
const actor = randomUUID();

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;
  clientQueries = await import("@/features/clients/server/queries");
  cycleActions = await import("@/features/treatment-cycles/server/actions");
  reviewActions = await import("@/features/treatment-cycles/server/review");

  await db.insert(s.user).values({
    id: actor,
    name: "Test Admin",
    email: `admin-${actor}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [studio] = await db.insert(s.studios).values(studioFixture()).returning();
  studioId = studio.id;

  roleIds = Object.fromEntries((await db.select().from(s.roles)).map((r) => [r.code, r.id]));

  await db.insert(s.studioMembers).values({ userId: actor, studioId, roleId: roleIds.OWNER, isActive: true });

  await db.insert(s.masters).values({ studioId, displayName: "Master Tester" });

  const zones = ["brows", "eyes", "lips", "skin", "lashes"] as const;
  for (const code of zones) {
    await db.insert(s.catalogZones).values({ code, label: code }).onConflictDoNothing();
  }
});

beforeEach(async () => {
  session.id = actor;
  session.studioId = studioId;
});

afterAll(async () => {
  if (database) await database.close();
});

test("Stage filtering: client with brows in qualification matches qualification filter", async () => {
  const [clientA] = await db.insert(s.clients).values(clientFixture(studioId)).returning();
  const [clientB] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Bob", fullName: "Bob Tester" }).returning();

  // Create cycle for clientA in qualification
  const created = await cycleActions.createCycleAction({ clientId: clientA.id, zoneCode: "brows", reason: "Client requested course" }, randomUUID());
  await cycleActions.transitionCycleAction({ id: created.id, to: "qualification", expectedVersion: 1, reason: "Advancing to qualification" }, randomUUID());

  // Query with status filter = "qualification"
  const result = await clientQueries.getClients(studioId, { status: "qualification" });
  expect(result.map((c) => c.id)).toContain(clientA.id);
  expect(result.map((c) => c.id)).not.toContain(clientB.id);

  // Result includes cycles summary
  const foundA = result.find((c) => c.id === clientA.id);
  expect(foundA?.cycles).toHaveLength(1);
  expect(foundA?.cycles[0]).toMatchObject({
    zoneCode: "brows",
    stage: "qualification",
  });
});

test("Multi-cycle semantics: client with brows=qualification and lips=qualification matches both filters without duplication", async () => {
  const [multiClient] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Multi", fullName: "Multi Client" }).returning();

  // Cycle 1: brows -> qualification
  const browsCycle = await cycleActions.createCycleAction({ clientId: multiClient.id, zoneCode: "brows", reason: "Client requested brows" }, randomUUID());
  await cycleActions.transitionCycleAction({ id: browsCycle.id, to: "qualification", expectedVersion: 1, reason: "Advancing brows" }, randomUUID());

  // Cycle 2: lips -> lost via reviewCycleAction
  const lipsCycle = await cycleActions.createCycleAction({ clientId: multiClient.id, zoneCode: "lips", reason: "Client requested lips" }, randomUUID());
  await reviewActions.reviewCycleAction({ id: lipsCycle.id, expectedVersion: 1, operation: "lost", reason: "Client lost on lips", comment: "Lost comment" }, randomUUID());

  // Matches qualification filter
  const qualResult = await clientQueries.getClients(studioId, { status: "qualification" });
  expect(qualResult.filter((c) => c.id === multiClient.id)).toHaveLength(1);

  // Matches lost filter
  const lostResult = await clientQueries.getClients(studioId, { status: "lost" });
  expect(lostResult.filter((c) => c.id === multiClient.id)).toHaveLength(1);

  // Does not match consultation_needed filter
  const consultResult = await clientQueries.getClients(studioId, { status: "consultation_needed" });
  expect(consultResult.map((c) => c.id)).not.toContain(multiClient.id);

  // Unfiltered query returns client once with both cycles
  const allResult = await clientQueries.getClients(studioId);
  const foundMulti = allResult.find((c) => c.id === multiClient.id);
  expect(foundMulti?.cycles).toHaveLength(2);
  const stages = foundMulti?.cycles.map((c) => `${c.zoneCode}:${c.stage}`);
  expect(stages).toContain("brows:qualification");
  expect(stages).toContain("lips:lost");
});

test("Zero-cycle clients: visible with no filter, excluded when stage filter is active", async () => {
  const [zeroClient] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Zero", fullName: "Zero Cycle" }).returning();

  // With no filter / status="all": visible
  const allClients = await clientQueries.getClients(studioId);
  expect(allClients.map((c) => c.id)).toContain(zeroClient.id);
  const foundZero = allClients.find((c) => c.id === zeroClient.id);
  expect(foundZero?.cycles).toEqual([]);

  // With any stage filter: excluded
  const filtered = await clientQueries.getClients(studioId, { status: "new_lead" });
  expect(filtered.map((c) => c.id)).not.toContain(zeroClient.id);
});

test("Archived cycles: excluded from workflow filtering and cycle summaries", async () => {
  const [archivedCycleClient] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Archived", fullName: "Archived Cycle Client" }).returning();

  // Create cycle in qualification
  const created = await cycleActions.createCycleAction({ clientId: archivedCycleClient.id, zoneCode: "brows", reason: "Client requested course" }, randomUUID());
  await cycleActions.transitionCycleAction({ id: created.id, to: "qualification", expectedVersion: 1, reason: "Advancing to qualification" }, randomUUID());

  // Archive the cycle directly
  await db.update(s.treatmentCycles).set({ archivedAt: new Date() }).where(eq(s.treatmentCycles.id, created.id));

  // Qualification filter must NOT match
  const qualResult = await clientQueries.getClients(studioId, { status: "qualification" });
  expect(qualResult.map((c) => c.id)).not.toContain(archivedCycleClient.id);

  // Client list returns empty cycles array
  const allResult = await clientQueries.getClients(studioId);
  const found = allResult.find((c) => c.id === archivedCycleClient.id);
  expect(found?.cycles).toEqual([]);

  // getClientById returns empty cycles array
  const byId = await clientQueries.getClientById(archivedCycleClient.id, studioId);
  expect(byId?.cycles).toEqual([]);
});

test("Terminal cycles: non-archived terminal cycles are filterable by their canonical stage", async () => {
  const [lostClient] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Lost", fullName: "Lost Client" }).returning();

  const created = await cycleActions.createCycleAction({ clientId: lostClient.id, zoneCode: "brows", reason: "Client requested course" }, randomUUID());
  await reviewActions.reviewCycleAction({ id: created.id, expectedVersion: 1, operation: "lost", reason: "Client lost", comment: "Lost comment" }, randomUUID());

  const lostResult = await clientQueries.getClients(studioId, { status: "lost" });
  expect(lostResult.map((c) => c.id)).toContain(lostClient.id);

  const qualResult = await clientQueries.getClients(studioId, { status: "qualification" });
  expect(qualResult.map((c) => c.id)).not.toContain(lostClient.id);
});

test("Canonical stages: CYCLE_STAGES contains all 21 defined stages", () => {
  expect(CYCLE_STAGES).toHaveLength(21);
  expect(CYCLE_STAGES).toContain("new_lead");
  expect(CYCLE_STAGES).toContain("qualification");
  expect(CYCLE_STAGES).toContain("procedure_slot_selected");
  expect(CYCLE_STAGES).toContain("cycle_completed");
  expect(CYCLE_STAGES).toContain("lost");
});
