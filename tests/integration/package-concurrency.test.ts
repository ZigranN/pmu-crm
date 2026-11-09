import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.id ? { user: { id: session.id } } : null),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "pmu_active_studio" && session.studioId
        ? { value: session.studioId }
        : undefined,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let createTotalFacePackageAction: typeof import("@/features/packages/server/actions").createTotalFacePackageAction;
let completeTotalFacePackageAction: typeof import("@/features/packages/server/actions").completeTotalFacePackageAction;
let createRemoverCycleAction: typeof import("@/features/treatment-cycles/server/actions").createRemoverCycleAction;

let studioId: string;
let ownerUserId: string;
let clientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const pkgActions = await import("@/features/packages/server/actions");
  createTotalFacePackageAction = pkgActions.createTotalFacePackageAction;
  completeTotalFacePackageAction = pkgActions.completeTotalFacePackageAction;

  const cycleActions = await import("@/features/treatment-cycles/server/actions");
  createRemoverCycleAction = cycleActions.createRemoverCycleAction;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Concurrency Test Studio",
        slug: `conc-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Owner User & Membership
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Concurrency Tester",
    email: `${ownerUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(s.studioMembers).values({
    studioId,
    userId: ownerUserId,
    roleId: ownerRoleId,
    isActive: true,
  });

  // 3. Master
  await db
    .insert(s.masters)
    .values({
      studioId,
      userId: ownerUserId,
      displayName: "Master Concurrency",
    });

  // 4. Client
  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Concurrent",
      fullName: "Concurrent Client",
      phone: `+39 333 ${Math.floor(1000000 + Math.random() * 9000000)}`,
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

async function setCycleStage(cycleId: string, fromStage: string, toStage: string, version: number) {
  const cmdId = randomUUID();
  const reqKey = randomUUID();
  await db.insert(s.commandReceipts).values({
    id: cmdId,
    studioId,
    actorId: ownerUserId,
    command: "cycle.transition.v1",
    requestKey: reqKey,
    payloadHash: `hash-${randomUUID()}`,
    result: { id: cycleId, version },
  });
  await db.insert(s.cycleStageHistory).values({
    studioId,
    cycleId,
    fromStage,
    toStage,
    version,
    actorId: ownerUserId,
    commandId: cmdId,
    reason: "Test stage transition",
  });
  await db
    .update(s.treatmentCycles)
    .set({ stage: toStage, version })
    .where(eq(s.treatmentCycles.id, cycleId));
}

describe("Package & Remover PostgreSQL Concurrency", () => {
  it("handles concurrent creation of Total Face package with identical requestKey", async () => {
    const reqKey = randomUUID();

    const [res1Val, res2Val] = await Promise.all([
      createTotalFacePackageAction(
        {
          clientId,
          zoneCodes: ["brows", "eyes", "lips"],
          reason: "Concurrent TF creation",
        },
        reqKey
      ),
      createTotalFacePackageAction(
        {
          clientId,
          zoneCodes: ["brows", "eyes", "lips"],
          reason: "Concurrent TF creation",
        },
        reqKey
      ),
    ]);

    const res1 = res1Val as any;
    const res2 = res2Val as any;

    expect(res1.id).toBe(res2.id);
    expect(res1.cycleIds).toEqual(res2.cycleIds);

    // Verify only 3 sibling cycles were created in total for this package
    const cycles = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.packageId, res1.id));

    expect(cycles.length).toBe(3);
  });

  it("handles concurrent creation of Remover cycles with identical requestKey", async () => {
    const reqKey = randomUUID();

    const [res1Val, res2Val] = await Promise.all([
      createRemoverCycleAction(
        {
          clientId,
          zoneCode: "eyes",
          reason: "Concurrent remover creation",
        },
        reqKey
      ),
      createRemoverCycleAction(
        {
          clientId,
          zoneCode: "eyes",
          reason: "Concurrent remover creation",
        },
        reqKey
      ),
    ]);

    const res1 = res1Val as any;
    const res2 = res2Val as any;

    expect(res1.id).toBe(res2.id);

    // Verify only 1 cycle was created
    const cycles = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, res1.id));

    expect(cycles.length).toBe(1);
  });

  it("handles concurrent package completions safely", async () => {
    const reqKey = randomUUID();
    const pkg = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows"],
        reason: "Single-zone package for completion race test",
      },
      reqKey
    )) as any;

    // Complete the single sibling cycle via helper
    await setCycleStage(pkg.cycleIds[0], "new_lead", "cycle_completed", 2);

    const completeReqKey = randomUUID();

    const [res1Val, res2Val] = await Promise.all([
      completeTotalFacePackageAction(
        {
          packageId: pkg.id,
          reason: "Concurrent completion attempt 1",
        },
        completeReqKey
      ),
      completeTotalFacePackageAction(
        {
          packageId: pkg.id,
          reason: "Concurrent completion attempt 1",
        },
        completeReqKey
      ),
    ]);

    const res1 = res1Val as any;
    const res2 = res2Val as any;

    expect(res1.status).toBe("completed");
    expect(res2.status).toBe("completed");

    const [dbPkg] = await db
      .select()
      .from(s.treatmentPackages)
      .where(eq(s.treatmentPackages.id, pkg.id));

    expect(dbPkg.status).toBe("completed");
  });
});
