import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
let getClientPackages: typeof import("@/features/packages/server/queries").getClientPackages;
let getPackageById: typeof import("@/features/packages/server/queries").getPackageById;

let studioId: string;
let otherStudioId: string;
let ownerUserId: string;
let clientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const pkgActions = await import("@/features/packages/server/actions");
  createTotalFacePackageAction = pkgActions.createTotalFacePackageAction;
  completeTotalFacePackageAction = pkgActions.completeTotalFacePackageAction;

  const pkgQueries = await import("@/features/packages/server/queries");
  getClientPackages = pkgQueries.getClientPackages;
  getPackageById = pkgQueries.getPackageById;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Total Face Test Studio",
        slug: `tf-studio-${randomUUID()}`,
      },
      {
        ...studioFixture(),
        name: "Other Studio",
        slug: `other-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const [otherSt] = await db
    .select()
    .from(s.studios)
    .where(eq(s.studios.name, "Other Studio"));
  otherStudioId = otherSt.id;

  // 2. Owner User & Membership
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Total Face Tester",
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
      displayName: "Master Vera",
    });

  // 4. Client
  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Elena",
      fullName: "Elena TotalFace",
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

describe("Total Face Packages Integration", () => {
  it("creates a Total Face package with 3 explicit sibling cycles", async () => {
    const reqKey = randomUUID();
    const result = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "eyes", "lips"],
        reason: "Инициализация пакета Total Face",
      },
      reqKey
    )) as any;

    expect(result.id).toBeDefined();
    expect(result.cycleIds.length).toBe(3);

    // Verify package in DB
    const [pkg] = await db
      .select()
      .from(s.treatmentPackages)
      .where(eq(s.treatmentPackages.id, result.id));

    expect(pkg).toBeDefined();
    expect(pkg.kind).toBe("total_face");
    expect(pkg.status).toBe("active");
    expect(pkg.clientId).toBe(clientId);

    // Verify sibling cycles
    const siblingCycles = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.packageId, result.id));

    expect(siblingCycles.length).toBe(3);
    const zones = siblingCycles.map((c) => c.zoneCode).sort();
    expect(zones).toEqual(["brows", "eyes", "lips"]);

    for (const c of siblingCycles) {
      expect(c.stage).toBe("new_lead");
      expect(c.kind).toBe("pmu");
      expect(c.packageId).toBe(pkg.id);
      expect(c.clientId).toBe(clientId);
    }

    // Verify audit log
    const [auditLog] = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.entityId, result.id),
          eq(s.auditLogs.action, "total_face_package_created")
        )
      );

    expect(auditLog).toBeDefined();
    expect(auditLog.entityType).toBe("treatment_package");
  });

  it("is idempotent: re-executing with the same requestKey returns the exact same result", async () => {
    const reqKey = randomUUID();
    const first = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "lips"],
        reason: "Пакет брови + губы",
      },
      reqKey
    )) as any;

    const second = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "lips"],
        reason: "Пакет брови + губы",
      },
      reqKey
    )) as any;

    expect(second.id).toBe(first.id);
    expect(second.cycleIds).toEqual(first.cycleIds);
  });

  it("rejects duplicate requestKey with altered payload", async () => {
    const reqKey = randomUUID();
    await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "lips"],
        reason: "Пакет брови + губы",
      },
      reqKey
    );

    await expect(
      createTotalFacePackageAction(
        {
          clientId,
          zoneCodes: ["eyes", "lips"],
          reason: "Измененный payload",
        },
        reqKey
      )
    ).rejects.toThrow();
  });

  it("rejects cross-studio client creation", async () => {
    // Switch active studio
    session.studioId = otherStudioId;

    await expect(
      createTotalFacePackageAction(
        {
          clientId, // Client belongs to studioId, not otherStudioId
          zoneCodes: ["brows", "eyes", "lips"],
          reason: "Cross studio attempt",
        },
        randomUUID()
      )
    ).rejects.toThrow();
  });

  it("rejects package creation with duplicate zone codes", async () => {
    await expect(
      createTotalFacePackageAction(
        {
          clientId,
          zoneCodes: ["brows", "brows" as any],
          reason: "Дублирование зон",
        },
        randomUUID()
      )
    ).rejects.toThrow();
  });

  it("sibling cycles remain strictly independent and cannot be completed prematurely", async () => {
    const reqKey = randomUUID();
    const pkgResult = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "eyes", "lips"],
        reason: "Независимость циклов",
      },
      reqKey
    )) as any;

    const [browsCycleId, eyesCycleId, lipsCycleId] = pkgResult.cycleIds;

    // Transition brows cycle to cycle_completed via helper
    await setCycleStage(browsCycleId, "new_lead", "cycle_completed", 2);

    // Check sibling states
    const [eyesCycle] = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, eyesCycleId));
    const [lipsCycle] = await db
      .select()
      .from(s.treatmentCycles)
      .where(eq(s.treatmentCycles.id, lipsCycleId));

    expect(eyesCycle.stage).toBe("new_lead");
    expect(lipsCycle.stage).toBe("new_lead");

    // Package query aggregate
    const clientPkgs = await getClientPackages(clientId);
    expect(clientPkgs.length).toBeGreaterThan(0);

    const agg = await getPackageById(pkgResult.id);
    expect(agg).toBeDefined();
    expect(agg?.completedCyclesCount).toBe(1);
    expect(agg?.totalCyclesCount).toBe(3);
    expect(agg?.canComplete).toBe(false);

    // Attempting to complete package fails because 2 siblings are unfinished
    await expect(
      completeTotalFacePackageAction(
        {
          packageId: pkgResult.id,
          reason: "Попытка преждевременного завершения",
        },
        randomUUID()
      )
    ).rejects.toThrow(/еще не завершены/);

    // Complete remaining siblings
    await setCycleStage(eyesCycleId, "new_lead", "cycle_completed", 2);
    await setCycleStage(lipsCycleId, "new_lead", "cycle_completed", 2);

    // Now package completion succeeds
    const completeRes = (await completeTotalFacePackageAction(
      {
        packageId: pkgResult.id,
        reason: "Все зоны Total Face завершены успешно",
      },
      randomUUID()
    )) as any;

    expect(completeRes.status).toBe("completed");

    const [completedPkg] = await db
      .select()
      .from(s.treatmentPackages)
      .where(eq(s.treatmentPackages.id, pkgResult.id));

    expect(completedPkg.status).toBe("completed");
    expect(completedPkg.completedAt).toBeDefined();

    // Verify audit log for completion
    const [completeAudit] = await db
      .select()
      .from(s.auditLogs)
      .where(
        and(
          eq(s.auditLogs.entityId, pkgResult.id),
          eq(s.auditLogs.action, "total_face_package_completed")
        )
      );

    expect(completeAudit).toBeDefined();
  });

  it("package completion is rejected when a sibling cycle is lost or in refresh_no_response", async () => {
    // 1. Test with a sibling in 'lost'
    const pkgLost = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "lips"],
        reason: "Пакет с потерянным циклом",
      },
      randomUUID()
    )) as any;

    const [browsLostId, lipsLostId] = pkgLost.cycleIds;
    await setCycleStage(browsLostId, "new_lead", "cycle_completed", 2);
    await setCycleStage(lipsLostId, "new_lead", "lost", 2);

    await expect(
      completeTotalFacePackageAction(
        {
          packageId: pkgLost.id,
          reason: "Попытка завершения с lost циклом",
        },
        randomUUID()
      )
    ).rejects.toThrow(/еще не завершены/);

    // 2. Test with a sibling in 'refresh_no_response'
    const pkgRefresh = (await createTotalFacePackageAction(
      {
        clientId,
        zoneCodes: ["brows", "eyes"],
        reason: "Пакет с refresh_no_response циклом",
      },
      randomUUID()
    )) as any;

    const [browsRefId, eyesRefId] = pkgRefresh.cycleIds;
    await setCycleStage(browsRefId, "new_lead", "cycle_completed", 2);
    await setCycleStage(eyesRefId, "new_lead", "refresh_no_response", 2);

    await expect(
      completeTotalFacePackageAction(
        {
          packageId: pkgRefresh.id,
          reason: "Попытка завершения с refresh_no_response циклом",
        },
        randomUUID()
      )
    ).rejects.toThrow(/еще не завершены/);
  });
});
