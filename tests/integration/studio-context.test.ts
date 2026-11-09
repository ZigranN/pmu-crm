import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, and } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import React from "react";
import * as s from "@/db/schema";
import type {
  ActiveStudioCookieState,
} from "@/server/auth/context";

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));

const cookieState = vi.hoisted(() => ({
  value: undefined as string | undefined,
  lastSetOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (sessionState.user ? { user: sessionState.user } : null),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      if (name === "pmu_active_studio" && cookieState.value !== undefined) {
        return { name: "pmu_active_studio", value: cookieState.value };
      }
      return undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (name === "pmu_active_studio") {
        cookieState.value = value;
        cookieState.lastSetOptions = { name, value, ...options };
      }
    },
    delete: (name: string) => {
      if (name === "pmu_active_studio") {
        cookieState.value = undefined;
        cookieState.lastSetOptions = undefined;
      }
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw err;
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;
let contextModule: typeof import("@/server/auth/context");
let scopesModule: typeof import("@/server/auth/scopes");
let actionsModule: typeof import("@/features/auth/server/actions");
let layoutModule: typeof import("@/app/(dashboard)/layout");
let DashboardShell: typeof import("@/components/layout/dashboard-shell").DashboardShell;
let SingleStudioBootstrap: typeof import("@/components/layout/single-studio-bootstrap").SingleStudioBootstrap;
let StudioSelector: typeof import("@/components/layout/studio-selector").StudioSelector;
let AutoClearStaleCookie: typeof import("@/components/layout/auto-clear-stale-cookie").AutoClearStaleCookie;

const userA = randomUUID();
const userB = randomUUID();
let studioA: string;
let studioB: string;
let inactiveStudio: string;
let roleIds: Record<string, string>;
const permissionIds = new Map<string, string>();
const permissionCodes = [
  "CLIENT_READ",
  "CLIENT_CREATE",
  "CLIENT_UPDATE",
  "CLIENT_ARCHIVE",
  "PAYMENT_REFUND",
  "MASTER_CREATE",
  "MASTER_UPDATE",
  "MASTER_ARCHIVE",
  "MASTER_READ",
  "SERVICE_CREATE",
  "SERVICE_UPDATE",
  "SERVICE_ARCHIVE",
  "SERVICE_READ",
  "CONSENT_UPLOAD",
  "CONSENT_READ",
  "MEDIA_CREATE",
  "MEDIA_READ",
  "OFFER_MANAGE",
  "SETTINGS_UPDATE",
  "MEDICAL_PROFILE_UPDATE",
  "MEDICAL_PROFILE_READ",
];

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;
  contextModule = await import("@/server/auth/context");
  scopesModule = await import("@/server/auth/scopes");
  actionsModule = await import("@/features/auth/server/actions");
  layoutModule = await import("@/app/(dashboard)/layout");
  DashboardShell = (await import("@/components/layout/dashboard-shell")).DashboardShell;
  SingleStudioBootstrap = (await import("@/components/layout/single-studio-bootstrap")).SingleStudioBootstrap;
  StudioSelector = (await import("@/components/layout/studio-selector")).StudioSelector;
  AutoClearStaleCookie = (await import("@/components/layout/auto-clear-stale-cookie")).AutoClearStaleCookie;

  // Insert test studios
  [studioA, studioB, inactiveStudio] = (
    await db
      .insert(s.studios)
      .values([
        { ...studioFixture(), name: "Studio A", slug: `studio-a-${randomUUID()}` },
        { ...studioFixture(), name: "Studio B", slug: `studio-b-${randomUUID()}` },
        { ...studioFixture(), name: "Inactive Studio", slug: `inactive-${randomUUID()}`, isActive: false },
      ])
      .returning()
  ).map((r) => r.id);

  // Insert test users
  await db.insert(s.user).values([
    {
      id: userA,
      name: "User Alpha",
      email: `${userA}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: userB,
      name: "User Beta",
      email: `${userB}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  // Load / insert roles and permissions
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map((r) => [r.code, r.id]));
  await db
    .insert(s.permissions)
    .values(permissionCodes.map((code) => ({ code, name: code })))
    .onConflictDoNothing();

  for (const p of await db.select().from(s.permissions).where(inArray(s.permissions.code, permissionCodes))) {
    permissionIds.set(p.code, p.id);
  }

  // userA is ADMIN in studioA
  await db.insert(s.studioMembers).values([
    { studioId: studioA, userId: userA, roleId: roleIds.ADMIN, isActive: true },
    { studioId: studioB, userId: userB, roleId: roleIds.ADMIN, isActive: true },
    { studioId: inactiveStudio, userId: userA, roleId: roleIds.ADMIN, isActive: true },
  ]);
});

beforeEach(async () => {
  redirectMock.mockClear();
  sessionState.user = { id: userA, email: `${userA}@example.test` };
  cookieState.value = studioA;
  await db.delete(s.userCustomPermissions).where(eq(s.userCustomPermissions.userId, userA));
  await db.update(s.studioMembers).set({ isActive: true }).where(eq(s.studioMembers.userId, userA));
  await db.update(s.studios).set({ isActive: true }).where(eq(s.studios.id, studioA));
});

afterAll(async () => {
  if (!database) return;
  try {
    await db.delete(s.studioMembers).where(inArray(s.studioMembers.userId, [userA, userB]));
    await db.delete(s.studios).where(inArray(s.studios.id, [studioA, studioB, inactiveStudio]));
    await db.delete(s.user).where(inArray(s.user.id, [userA, userB]));
  } finally {
    await database.close();
  }
});

test("1. unauthenticated session throws AUTH_REQUIRED", async () => {
  sessionState.user = null;
  await expect(contextModule.requireAuthenticatedUser()).rejects.toThrowError(contextModule.AuthRequiredError);
  await expect(contextModule.requireAuthenticatedUser()).rejects.toThrow("AUTH_REQUIRED");
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(contextModule.AuthRequiredError);
});

test("2. authenticated user + missing cookie throws STUDIO_CONTEXT_REQUIRED", async () => {
  cookieState.value = undefined;
  const state: ActiveStudioCookieState = await contextModule.readActiveStudioCookieState();
  expect(state).toEqual({ kind: "missing" });

  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(
    contextModule.StudioContextRequiredError
  );
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_REQUIRED");
});

test("3. malformed / non-UUID cookie throws STUDIO_CONTEXT_STALE", async () => {
  cookieState.value = "not-a-valid-uuid";
  const state: ActiveStudioCookieState = await contextModule.readActiveStudioCookieState();
  expect(state).toEqual({ kind: "invalid" });

  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(
    contextModule.StudioContextStaleError
  );
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_STALE");
});

test("4. valid cookie + active membership + active studio returns valid StudioContext", async () => {
  expect(contextModule.ACTIVE_STUDIO_COOKIE).toBe("pmu_active_studio");
  cookieState.value = studioA;
  const state: ActiveStudioCookieState = await contextModule.readActiveStudioCookieState();
  expect(state).toEqual({ kind: "valid", studioId: studioA });

  const context = await contextModule.requireBrowserStudioContext();
  expect(context).toMatchObject({
    userId: userA,
    userEmail: `${userA}@example.test`,
    studioId: studioA,
    role: "ADMIN",
    studioName: "Studio A",
  });
  expect(context.membershipId).toBeDefined();
});

test("5. valid cookie + foreign studio throws STUDIO_CONTEXT_STALE", async () => {
  // studioB is a valid UUID, but userA is NOT a member of studioB
  cookieState.value = studioB;
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(
    contextModule.StudioContextStaleError
  );
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_STALE");
});

test("6. valid cookie + revoked/inactive membership throws STUDIO_CONTEXT_STALE", async () => {
  await db
    .update(s.studioMembers)
    .set({ isActive: false })
    .where(eq(s.studioMembers.userId, userA));

  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(
    contextModule.StudioContextStaleError
  );
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_STALE");
});

test("6b. valid cookie + inactive studio throws STUDIO_CONTEXT_STALE", async () => {
  await db.update(s.studios).set({ isActive: false }).where(eq(s.studios.id, studioA));
  cookieState.value = studioA;
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrowError(
    contextModule.StudioContextStaleError
  );
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_STALE");
});

test("7. explicit valid studio returns valid StudioContext for explicit callers", async () => {
  const context = await contextModule.requireStudioContextFor(userA, studioA);
  expect(context).toMatchObject({
    userId: userA,
    studioId: studioA,
    role: "ADMIN",
    studioName: "Studio A",
  });
});

test("8. explicit foreign/invalid studio throws STUDIO_ACCESS_DENIED", async () => {
  await expect(contextModule.requireStudioContextFor(userA, studioB)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
  await expect(contextModule.requireStudioContextFor(userA, studioB)).rejects.toThrow("STUDIO_ACCESS_DENIED");
  await expect(contextModule.requireStudioContextFor(userA, "invalid-uuid")).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
  await expect(contextModule.requireStudioContextFor(userA, inactiveStudio)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
  await expect(contextModule.requireStudioContextFor("", studioA)).rejects.toThrowError(
    contextModule.AuthRequiredError
  );
});

test("9. browser permission check grants allowed permission", async () => {
  cookieState.value = studioA;
  const context = await contextModule.requireBrowserStudioPermission("CLIENT_READ");
  expect(context.studioId).toBe(studioA);
});

test("10. role normally grants capability + custom DENY override rejects with FORBIDDEN_PERMISSION", async () => {
  cookieState.value = studioA;
  // ADMIN role normally has CLIENT_READ capability
  await db.insert(s.userCustomPermissions).values({
    userId: userA,
    studioId: studioA,
    permissionId: permissionIds.get("CLIENT_READ")!,
    effect: "deny",
  });

  await expect(contextModule.requireBrowserStudioPermission("CLIENT_READ")).rejects.toThrowError(
    contextModule.ForbiddenPermissionError
  );
  await expect(contextModule.requireBrowserStudioPermission("CLIENT_READ")).rejects.toThrow("FORBIDDEN_PERMISSION");

  // Also via explicit resolver
  await expect(contextModule.requireStudioPermissionFor(userA, studioA, "CLIENT_READ")).rejects.toThrowError(
    contextModule.ForbiddenPermissionError
  );
});

test("11. custom ALLOW override within role ceiling behaves per canonical engine", async () => {
  cookieState.value = studioA;
  // ADMIN cannot PAYMENT_REFUND by system capability ceiling (ROLE_CAPABILITIES.ADMIN does not include PAYMENT_REFUND)
  await db.insert(s.userCustomPermissions).values({
    userId: userA,
    studioId: studioA,
    permissionId: permissionIds.get("PAYMENT_REFUND")!,
    effect: "allow",
  });

  // Since ADMIN capability ceiling forbids PAYMENT_REFUND, canonical hasPermission fails closed
  await expect(contextModule.requireBrowserStudioPermission("PAYMENT_REFUND")).rejects.toThrowError(
    contextModule.ForbiddenPermissionError
  );
});

test("12. withBrowserStudioCommand executes within locked transaction and checks permission", async () => {
  cookieState.value = studioA;
  let executed = false;
  const result = await scopesModule.withBrowserStudioCommand("CLIENT_READ", async (tx, context) => {
    expect(context.studioId).toBe(studioA);
    expect(context.userId).toBe(userA);
    executed = true;
    return "command-success";
  });
  expect(result).toBe("command-success");
  expect(executed).toBe(true);
});

test("13. withBrowserStudioCommand rejects when custom DENY override is present", async () => {
  cookieState.value = studioA;
  await db.insert(s.userCustomPermissions).values({
    userId: userA,
    studioId: studioA,
    permissionId: permissionIds.get("CLIENT_READ")!,
    effect: "deny",
  });

  await expect(
    scopesModule.withBrowserStudioCommand("CLIENT_READ", async () => "should-not-run")
  ).rejects.toThrowError(contextModule.ForbiddenPermissionError);
});

test("14. setActiveStudioAction rejects unauthenticated user", async () => {
  sessionState.user = null;
  await expect(actionsModule.setActiveStudioAction(studioA)).rejects.toThrowError(
    contextModule.AuthRequiredError
  );
});

test("15. setActiveStudioAction rejects invalid / malformed UUID", async () => {
  await expect(actionsModule.setActiveStudioAction("not-a-uuid")).rejects.toThrow("INVALID_STUDIO_ID");
  await expect(actionsModule.setActiveStudioAction("")).rejects.toThrow("INVALID_STUDIO_ID");
});

test("16. setActiveStudioAction rejects foreign studio", async () => {
  await expect(actionsModule.setActiveStudioAction(studioB)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
});

test("17. setActiveStudioAction rejects inactive membership", async () => {
  await db
    .update(s.studioMembers)
    .set({ isActive: false })
    .where(eq(s.studioMembers.userId, userA));

  await expect(actionsModule.setActiveStudioAction(studioA)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
});

test("18. setActiveStudioAction rejects inactive studio", async () => {
  await expect(actionsModule.setActiveStudioAction(inactiveStudio)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
});

test("19. setActiveStudioAction sets canonical HttpOnly cookie contract on success", async () => {
  cookieState.value = undefined;
  cookieState.lastSetOptions = undefined;

  const res = await actionsModule.setActiveStudioAction(studioA);
  expect(res).toEqual({
    success: true,
    studioId: studioA,
    studioName: "Studio A",
  });
  expect(cookieState.value).toBe(studioA);
  expect(cookieState.lastSetOptions).toMatchObject({
    name: "pmu_active_studio",
    value: studioA,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
});

test("20. clearActiveStudioAction clears active studio cookie", async () => {
  cookieState.value = studioA;
  const res = await actionsModule.clearActiveStudioAction();
  expect(res).toEqual({ success: true });
  expect(cookieState.value).toBeUndefined();
});

test("21. clearActiveStudioAction rejects unauthenticated user", async () => {
  sessionState.user = null;
  await expect(actionsModule.clearActiveStudioAction()).rejects.toThrowError(
    contextModule.AuthRequiredError
  );
});

test("22. getUserActiveStudios returns active memberships in active studios only", async () => {
  const studios = await contextModule.getUserActiveStudios(userA);
  expect(studios).toHaveLength(1);
  expect(studios[0]).toMatchObject({
    studioId: studioA,
    studioName: "Studio A",
    role: "ADMIN",
  });
  expect(studios[0].membershipId).toBeDefined();
});

test("23. getUserActiveStudios returns empty array for user with 0 active memberships", async () => {
  const studios = await contextModule.getUserActiveStudios(randomUUID());
  expect(studios).toEqual([]);
});

test("24. getUserActiveStudios returns deterministically sorted list for UI display", async () => {
  // Add another active studio for userA
  const [studioC] = (
    await db
      .insert(s.studios)
      .values([{ ...studioFixture(), name: "Alpha Studio", slug: `alpha-${randomUUID()}` }])
      .returning()
  ).map((r) => r.id);

  await db.insert(s.studioMembers).values({
    studioId: studioC,
    userId: userA,
    roleId: roleIds.ADMIN,
    isActive: true,
  });

  try {
    const list = await contextModule.getUserActiveStudios(userA);
    expect(list).toHaveLength(2);
    // "Alpha Studio" comes before "Studio A"
    expect(list[0].studioName).toBe("Alpha Studio");
    expect(list[1].studioName).toBe("Studio A");
  } finally {
    await db.delete(s.studioMembers).where(eq(s.studioMembers.studioId, studioC));
    await db.delete(s.studios).where(eq(s.studios.id, studioC));
  }
});

test("25. getActiveStudiosAction delegates to getUserActiveStudios for session user", async () => {
  const list = await actionsModule.getActiveStudiosAction();
  expect(list).toHaveLength(1);
  expect(list[0].studioId).toBe(studioA);
});

test("26. membership revoked between render and selection fails closed (race condition)", async () => {
  // Simulate client rendering with valid membership list, but before setActiveStudioAction executes, membership is revoked
  cookieState.value = undefined;
  await db
    .update(s.studioMembers)
    .set({ isActive: false })
    .where(eq(s.studioMembers.userId, userA));

  await expect(actionsModule.setActiveStudioAction(studioA)).rejects.toThrowError(
    contextModule.StudioAccessDeniedError
  );
  // Cookie is NOT set/authorized for revoked studio
  expect(cookieState.value).toBeUndefined();
});

const sentinelChild = React.createElement(
  "div",
  { "data-testid": "tenant-secret" },
  "sensitive tenant data"
);

function containsElement(tree: unknown, target: unknown): boolean {
  if (!tree || typeof tree !== "object") return false;
  if (tree === target) return true;
  const el = tree as { props?: { children?: unknown } };
  if (el.props && el.props.children) {
    if (Array.isArray(el.props.children)) {
      for (const child of el.props.children) {
        if (containsElement(child, target)) return true;
      }
    } else {
      if (containsElement(el.props.children, target)) return true;
    }
  }
  return false;
}

function findElementType(
  tree: unknown,
  type: unknown
): { type: unknown; props: Record<string, unknown> } | null {
  if (!tree || typeof tree !== "object") return null;
  const el = tree as {
    type?: unknown;
    props?: { children?: unknown; [k: string]: unknown };
  };
  if (el.type === type) return el as { type: unknown; props: Record<string, unknown> };
  if (el.props && el.props.children) {
    if (Array.isArray(el.props.children)) {
      for (const child of el.props.children) {
        const found = findElementType(child, type);
        if (found) return found;
      }
    } else {
      return findElementType(el.props.children, type);
    }
  }
  return null;
}

test("27. Layout Gate - unauthenticated session redirects to /login and never renders tenant children", async () => {
  sessionState.user = null;
  await expect(layoutModule.default({ children: sentinelChild })).rejects.toThrow("NEXT_REDIRECT: /login");
  expect(redirectMock).toHaveBeenCalledWith("/login");
});

test("28. Layout Gate - zero active memberships renders safe no-studio state and blocks tenant children", async () => {
  const userZero = randomUUID();
  sessionState.user = { id: userZero, email: `${userZero}@example.test` };
  cookieState.value = undefined;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);

  const shell = findElementType(res, DashboardShell);
  expect(shell).toBeDefined();
  expect(shell?.props.studioId).toBeUndefined();
  expect(JSON.stringify(res)).toContain("Нет активной студии");
});

test("29. Layout Gate - zero active memberships with stale cookie includes AutoClearStaleCookie and blocks tenant children", async () => {
  const userZero = randomUUID();
  sessionState.user = { id: userZero, email: `${userZero}@example.test` };
  cookieState.value = studioA;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);

  const autoClear = findElementType(res, AutoClearStaleCookie);
  expect(autoClear).toBeDefined();
});

test("30. Layout Gate - single active membership + missing cookie renders SingleStudioBootstrap and blocks tenant children", async () => {
  cookieState.value = undefined;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);

  const bootstrap = findElementType(res, SingleStudioBootstrap);
  expect(bootstrap).toBeDefined();
  expect(bootstrap?.props.studio).toMatchObject({
    studioId: studioA,
    studioName: "Studio A",
    role: "ADMIN",
  });
});

test("31. Layout Gate - multiple active memberships + missing cookie renders StudioSelector (not stale) and blocks tenant children", async () => {
  // Grant userA active membership in studioB as well
  await db.insert(s.studioMembers).values({
    studioId: studioB,
    userId: userA,
    roleId: roleIds.ADMIN,
    isActive: true,
  });

  try {
    cookieState.value = undefined;
    const res = await layoutModule.default({ children: sentinelChild });
    expect(containsElement(res, sentinelChild)).toBe(false);

    const selector = findElementType(res, StudioSelector);
    expect(selector).toBeDefined();
    expect(selector?.props.isStale).toBe(false);
    expect((selector?.props.activeStudios as unknown[])?.length).toBe(2);
  } finally {
    await db
      .delete(s.studioMembers)
      .where(and(eq(s.studioMembers.studioId, studioB), eq(s.studioMembers.userId, userA)));
  }
});

test("32. Layout Gate - malformed non-UUID cookie blocks tenant children and renders stale recovery", async () => {
  cookieState.value = "not-a-valid-uuid";

  // For 1 membership: renders SingleStudioBootstrap
  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);
  expect(findElementType(res, SingleStudioBootstrap)).toBeDefined();

  // For >1 memberships: renders StudioSelector with isStale=true
  await db.insert(s.studioMembers).values({
    studioId: studioB,
    userId: userA,
    roleId: roleIds.ADMIN,
    isActive: true,
  });

  try {
    const resMulti = await layoutModule.default({ children: sentinelChild });
    expect(containsElement(resMulti, sentinelChild)).toBe(false);

    const selector = findElementType(resMulti, StudioSelector);
    expect(selector).toBeDefined();
    expect(selector?.props.isStale).toBe(true);
  } finally {
    await db
      .delete(s.studioMembers)
      .where(and(eq(s.studioMembers.studioId, studioB), eq(s.studioMembers.userId, userA)));
  }
});

test("33. Layout Gate - valid UUID cookie pointing to foreign studio blocks tenant children and renders stale recovery", async () => {
  // userA is member of studioA only; cookie points to studioB
  cookieState.value = studioB;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);

  // Single active membership -> SingleStudioBootstrap to establish valid studioA
  const bootstrap = findElementType(res, SingleStudioBootstrap);
  expect(bootstrap).toBeDefined();
  expect(bootstrap?.props.studio).toMatchObject({ studioId: studioA });
});

test("34. Layout Gate - valid UUID cookie pointing to revoked membership blocks tenant children and renders stale recovery", async () => {
  // userA has active studioB and revoked studioA
  await db.insert(s.studioMembers).values({
    studioId: studioB,
    userId: userA,
    roleId: roleIds.ADMIN,
    isActive: true,
  });
  await db
    .update(s.studioMembers)
    .set({ isActive: false })
    .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));

  cookieState.value = studioA; // points to revoked membership

  try {
    const res = await layoutModule.default({ children: sentinelChild });
    expect(containsElement(res, sentinelChild)).toBe(false);

    // Sole active studio is now studioB
    const bootstrap = findElementType(res, SingleStudioBootstrap);
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.props.studio).toMatchObject({ studioId: studioB });
  } finally {
    await db
      .delete(s.studioMembers)
      .where(and(eq(s.studioMembers.studioId, studioB), eq(s.studioMembers.userId, userA)));
    await db
      .update(s.studioMembers)
      .set({ isActive: true })
      .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));
  }
});

test("35. Layout Gate - valid UUID cookie pointing to deactivated studio blocks tenant children and renders stale recovery", async () => {
  // cookie points to inactiveStudio where userA has membership, but studio.isActive=false
  cookieState.value = inactiveStudio;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(false);

  // Active studio is studioA
  const bootstrap = findElementType(res, SingleStudioBootstrap);
  expect(bootstrap).toBeDefined();
  expect(bootstrap?.props.studio).toMatchObject({ studioId: studioA });
});

test("36. Layout Gate - valid cookie + active membership renders DashboardShell with correct studio identity and renders tenant children", async () => {
  cookieState.value = studioA;

  const res = await layoutModule.default({ children: sentinelChild });
  expect(containsElement(res, sentinelChild)).toBe(true);

  expect(res.type).toBe(DashboardShell);
  expect(res.props.studioId).toBe(studioA);
  expect(res.props.studioName).toBe("Studio A");
  expect(res.props.role).toBe("ADMIN");
  expect(res.props.activeStudios).toHaveLength(1);
  expect(res.props.children).toBe(sentinelChild);
});

// ---------------------------------------------------------------------------
// PHASE 1.1C2: READ ISOLATION & EXPLICIT CONTEXT VERIFICATION
// ---------------------------------------------------------------------------

test("38. Read Isolation - Studio A active context + Studio A client ID is readable", async () => {
  const { getClientById } = await import("@/features/clients/server/queries");
  const [clientInA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "Anna",
      lastName: "Ivanova",
      fullName: "Anna Ivanova",
      phone: "+79991112233",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const client = await getClientById(clientInA.id, studioA);
    expect(client).toBeDefined();
    expect(client?.id).toBe(clientInA.id);
    expect(client?.fullName).toBe("Anna Ivanova");
  } finally {
    await db.delete(s.clients).where(eq(s.clients.id, clientInA.id));
  }
});

test("39. Read Isolation - Studio A active context + Studio B client ID is NOT readable (cross-tenant boundary)", async () => {
  const { getClientById } = await import("@/features/clients/server/queries");
  const [clientInB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "Boris",
      lastName: "Petrov",
      fullName: "Boris Petrov",
      phone: "+79992223344",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    // Attempt 1: Caller uses studioA active context and requests client in studioA scope -> returns undefined (scoped query fails)
    cookieState.value = studioA;
    const clientUnderStudioA = await getClientById(clientInB.id, studioA);
    expect(clientUnderStudioA).toBeUndefined();

    // Attempt 2: Caller uses studioA active context and tries to query under studioB scope -> rejected with STUDIO_ACCESS_DENIED
    await expect(getClientById(clientInB.id, studioB)).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(eq(s.clients.id, clientInB.id));
  }
});

test("40. Read Isolation - Studio A context cannot read Studio B audit/journal records", async () => {
  const { getJournal } = await import("@/features/audit/server/queries");
  
  // Make userA an OWNER in studioA to have audit permission
  await db
    .update(s.studioMembers)
    .set({ roleId: roleIds.OWNER })
    .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));

  try {
    cookieState.value = studioA;
    
    // Reading studioA audit log succeeds
    const studioALogs = await getJournal(studioA, "audit", 1);
    expect(Array.isArray(studioALogs)).toBe(true);

    // Attempting to read studioB audit logs while active in studioA or unauthorized in studioB fails closed
    await expect(getJournal(studioB, "audit", 1)).rejects.toThrow();
  } finally {
    await db
      .update(s.studioMembers)
      .set({ roleId: roleIds.ADMIN })
      .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));
  }
});

test("41. Read Isolation - Multi-Studio user can switch active context and read only the newly active Studio clients", async () => {
  const { getClients } = await import("@/features/clients/server/queries");

  // Grant userA membership in studioB
  await db.insert(s.studioMembers).values({
    studioId: studioB,
    userId: userA,
    roleId: roleIds.ADMIN,
    isActive: true,
  });

  const [clientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "ClientInA",
      fullName: "ClientInA",
      phone: "+79993334455",
      clientStatus: "new_lead",
    })
    .returning();

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "ClientInB",
      fullName: "ClientInB",
      phone: "+79994445566",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    // Under studioA context:
    await actionsModule.setActiveStudioAction(studioA);
    const clientsUnderA = await getClients(studioA);
    expect(clientsUnderA.some((c) => c.id === clientA.id)).toBe(true);
    expect(clientsUnderA.some((c) => c.id === clientB.id)).toBe(false);

    // Switch to studioB context:
    await actionsModule.setActiveStudioAction(studioB);
    const clientsUnderB = await getClients(studioB);
    expect(clientsUnderB.some((c) => c.id === clientA.id)).toBe(false);
    expect(clientsUnderB.some((c) => c.id === clientB.id)).toBe(true);
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [clientA.id, clientB.id]));
    await db
      .delete(s.studioMembers)
      .where(and(eq(s.studioMembers.studioId, studioB), eq(s.studioMembers.userId, userA)));
  }
});

test("42. Read Isolation - Missing context blocks Studio-scoped read service", async () => {
  cookieState.value = undefined;

  // Passing undefined to studioId or relying on browser context when cookie is missing fails closed
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_REQUIRED");
});

test("43. Read Isolation - Stale context blocks Studio-scoped read service", async () => {
  cookieState.value = "malformed-non-uuid";

  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_STALE");
});

test("44. Read Isolation - No implicit first-membership fallback occurs on migrated reads", async () => {
  // UserA has active membership in studioA, but cookie is missing
  cookieState.value = undefined;

  // With zero cookie, requireBrowserStudioContext must throw STUDIO_CONTEXT_REQUIRED instead of returning studioA
  await expect(contextModule.requireBrowserStudioContext()).rejects.toThrow("STUDIO_CONTEXT_REQUIRED");
});

test("45. Read Isolation - Sensitive-read access log records the correct explicit Studio ID", async () => {
  const { getClientById } = await import("@/features/clients/server/queries");
  const [clientInA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "LogTestClient",
      fullName: "LogTestClient",
      phone: "+79995556677",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    await getClientById(clientInA.id, studioA);

    // Query recent access log
    const recentLogs = await db
      .select()
      .from(s.accessLogs)
      .where(and(eq(s.accessLogs.studioId, studioA), eq(s.accessLogs.actorId, userA)))
      .orderBy(eq(s.accessLogs.targetId, clientInA.id));

    expect(recentLogs.length).toBeGreaterThan(0);
    const matchingLog = recentLogs.find((l) => l.targetId === clientInA.id);
    expect(matchingLog).toBeDefined();
    expect(matchingLog?.studioId).toBe(studioA);
    expect(matchingLog?.operation).toBe("client.read");
  } finally {
    await db.delete(s.clients).where(eq(s.clients.id, clientInA.id));
  }
});

test("46. Merge Read - getMergeCandidates returns only Studio A candidates and excludes foreign studio", async () => {
  const { getMergeCandidates } = await import("@/features/clients/server/merge-actions");

  const [targetClientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "TargetA",
      fullName: "TargetA",
      phone: "+79996660001",
      clientStatus: "new_lead",
    })
    .returning();

  const [candidateClientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "CandidateA",
      fullName: "CandidateA",
      phone: "+79996660002",
      clientStatus: "new_lead",
    })
    .returning();

  const [clientInB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "ClientInB",
      fullName: "ClientInB",
      phone: "+79996660003",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const candidates = await getMergeCandidates(targetClientA.id, studioA);
    expect(candidates.some((c) => c.id === candidateClientA.id)).toBe(true);
    expect(candidates.some((c) => c.id === clientInB.id)).toBe(false);

    // Cross-studio explicit read fails closed
    await expect(getMergeCandidates(targetClientA.id, studioB)).rejects.toThrow();

    // Stale/invalid cookie fails closed
    cookieState.value = "invalid-non-uuid";
    await expect(getMergeCandidates(targetClientA.id)).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [targetClientA.id, candidateClientA.id, clientInB.id]));
  }
});

test("47. Merge Read - getClientMergeHistory returns only Studio A merge history and fails on foreign client", async () => {
  const { getClientMergeHistory } = await import("@/features/clients/server/merge-actions");

  const [clientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "MergeHistA",
      fullName: "MergeHistA",
      phone: "+79997770001",
      clientStatus: "new_lead",
    })
    .returning();

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "MergeHistB",
      fullName: "MergeHistB",
      phone: "+79997770002",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const historyA = await getClientMergeHistory(clientA.id, studioA);
    expect(Array.isArray(historyA)).toBe(true);

    // Requesting foreign client history fails closed or returns empty
    await expect(getClientMergeHistory(clientB.id, studioA)).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [clientA.id, clientB.id]));
  }
});

test("48. Merge Read - previewClientMerge validates studio context and fails closed on foreign client", async () => {
  const { previewClientMerge } = await import("@/features/clients/server/merge-actions");

  const [sourceA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "PreviewSourceA",
      fullName: "PreviewSourceA",
      phone: "+79998880001",
      clientStatus: "new_lead",
    })
    .returning();

  const [targetA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "PreviewTargetA",
      fullName: "PreviewTargetA",
      phone: "+79998880002",
      clientStatus: "new_lead",
    })
    .returning();

  const [targetB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "PreviewTargetB",
      fullName: "PreviewTargetB",
      phone: "+79998880003",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const preview = await previewClientMerge({ sourceId: sourceA.id, targetId: targetA.id }, studioA);
    expect(preview).toBeDefined();
    expect(preview.sourceId).toBe(sourceA.id);
    expect(preview.targetId).toBe(targetA.id);

    // Cross-studio preview fails closed
    await expect(
      previewClientMerge({ sourceId: sourceA.id, targetId: targetB.id }, studioA)
    ).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [sourceA.id, targetA.id, targetB.id]));
  }
});

test("49. Consent Read - getClientConsentsAction enforces active browser context and scopes to studio", async () => {
  const { getClientConsentsAction } = await import("@/features/consent/server/actions");

  const [clientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "ConsentClientA",
      fullName: "ConsentClientA",
      phone: "+79999990001",
      clientStatus: "new_lead",
    })
    .returning();

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "ConsentClientB",
      fullName: "ConsentClientB",
      phone: "+79999990002",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const consentsA = await getClientConsentsAction(clientA.id);
    expect(Array.isArray(consentsA)).toBe(true);

    // Foreign client in Studio B returns empty array or fails closed
    const consentsB = await getClientConsentsAction(clientB.id);
    expect(consentsB).toEqual([]);

    // Missing cookie rejects
    cookieState.value = undefined;
    await expect(getClientConsentsAction(clientA.id)).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [clientA.id, clientB.id]));
  }
});

test("50. Media Read - getClientMediaAction enforces active browser context and scopes to studio", async () => {
  const { getClientMediaAction } = await import("@/features/media/server/actions");

  const [clientA] = await db
    .insert(s.clients)
    .values({
      studioId: studioA,
      firstName: "MediaClientA",
      fullName: "MediaClientA",
      phone: "+79991119991",
      clientStatus: "new_lead",
    })
    .returning();

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "MediaClientB",
      fullName: "MediaClientB",
      phone: "+79991119992",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    cookieState.value = studioA;
    const mediaA = await getClientMediaAction(clientA.id, "media");
    expect(Array.isArray(mediaA)).toBe(true);

    // Foreign client in Studio B returns empty array
    const mediaB = await getClientMediaAction(clientB.id, "media");
    expect(mediaB).toEqual([]);

    // Missing cookie rejects
    cookieState.value = undefined;
    await expect(getClientMediaAction(clientA.id, "media")).rejects.toThrow();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [clientA.id, clientB.id]));
  }
});

test("51. Mutation Isolation - Client: Studio A creates only in A, cannot update or archive Client B", async () => {
  const { createClientAction, updateClientAction, archiveClientAction } = await import(
    "@/features/clients/server/actions"
  );

  cookieState.value = studioA;
  const created = await createClientAction(
    { firstName: "IsoClientA", phone: "+79990001111" },
    randomUUID()
  );
  expect(created.id).toBeDefined();

  const [savedA] = await db.select().from(s.clients).where(eq(s.clients.id, created.id));
  expect(savedA.studioId).toBe(studioA);

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "IsoClientB",
      fullName: "IsoClientB",
      phone: "+79990001112",
      clientStatus: "new_lead",
    })
    .returning();

  try {
    // Attempting to update client B from studio A context must fail
    await expect(
      updateClientAction(clientB.id, { firstName: "HackedB", phone: "+79990001112" })
    ).rejects.toThrow();

    // Attempting to archive client B from studio A context must fail
    await expect(archiveClientAction(clientB.id)).rejects.toThrow();

    // Assert Client B remains unchanged in database
    const [afterB] = await db.select().from(s.clients).where(eq(s.clients.id, clientB.id));
    expect(afterB.firstName).toBe("IsoClientB");
    expect(afterB.deletedAt).toBeNull();
  } finally {
    await db.delete(s.clients).where(inArray(s.clients.id, [created.id, clientB.id]));
  }
});

test("52. Mutation Isolation - Master: Studio A creates only in A, cannot mutate Master B", async () => {
  const { createMasterAction, updateMasterAction, archiveMasterAction } = await import(
    "@/features/masters/server/actions"
  );

  await db
    .update(s.studioMembers)
    .set({ roleId: roleIds.OWNER })
    .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));

  cookieState.value = studioA;
  const created = await createMasterAction({
    displayName: "IsoMasterA",
    calendarColor: "#112233",
    isActive: true,
  });
  expect(created.id).toBeDefined();

  const [savedA] = await db.select().from(s.masters).where(eq(s.masters.id, created.id));
  expect(savedA.studioId).toBe(studioA);

  const [masterB] = await db
    .insert(s.masters)
    .values({
      studioId: studioB,
      displayName: "IsoMasterB",
      calendarColor: "#445566",
      isActive: true,
    })
    .returning();

  try {
    await expect(
      updateMasterAction(masterB.id, {
        displayName: "HackedMasterB",
        calendarColor: "#999999",
        isActive: true,
      })
    ).rejects.toThrow();

    await expect(archiveMasterAction(masterB.id)).rejects.toThrow();

    // Assert Master B remains unchanged
    const [afterB] = await db.select().from(s.masters).where(eq(s.masters.id, masterB.id));
    expect(afterB.displayName).toBe("IsoMasterB");
    expect(afterB.deletedAt).toBeNull();
  } finally {
    await db.delete(s.masters).where(inArray(s.masters.id, [created.id, masterB.id]));
    await db
      .update(s.studioMembers)
      .set({ roleId: roleIds.ADMIN })
      .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));
  }
});

test("53. Mutation Isolation - Service: Studio A creates only in A, cannot update or archive Service B", async () => {
  const { createServiceAction, updateServiceAction, archiveServiceAction } = await import(
    "@/features/services/server/actions"
  );

  await db
    .update(s.studioMembers)
    .set({ roleId: roleIds.OWNER })
    .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));

  cookieState.value = studioA;
  const created = await createServiceAction(
    {
      priceChangeReason: "Initial pricing",
      catalogCode: "brows-shading",
      priceMode: "fixed",
      price: 150,
      priceMax: null,
      durationMinutes: 120,
      preparationTemplateId: null,
      postCareTemplateId: null,
      isActive: true,
    },
    randomUUID()
  );
  expect(created.id).toBeDefined();

  const [savedA] = await db.select().from(s.services).where(eq(s.services.id, created.id));
  expect(savedA.studioId).toBe(studioA);

  const [serviceB] = await db
    .insert(s.services)
    .values({
      studioId: studioB,
      name: "IsoServiceB",
      category: "brows",
      procedureType: "brows",
      priceCents: 20000,
      durationMinutes: 120,
      isActive: true,
    })
    .returning();

  try {
    await expect(
      updateServiceAction(serviceB.id, {
        priceChangeReason: "Hacked update",
        catalogCode: "brows-shading",
        priceMode: "fixed",
        price: 999,
        priceMax: null,
        durationMinutes: 120,
        preparationTemplateId: null,
        postCareTemplateId: null,
        isActive: true,
      })
    ).rejects.toThrow();

    await expect(archiveServiceAction(serviceB.id)).rejects.toThrow();

    // Assert Service B remains unchanged
    const [afterB] = await db.select().from(s.services).where(eq(s.services.id, serviceB.id));
    expect(afterB.priceCents).toBe(20000);
    expect(afterB.deletedAt).toBeNull();
  } finally {
    await db.delete(s.services).where(inArray(s.services.id, [created.id, serviceB.id]));
    await db
      .update(s.studioMembers)
      .set({ roleId: roleIds.ADMIN })
      .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));
  }
});

test("54. Mutation Isolation - Consent: Studio A context cannot delete consent belonging to Client B", async () => {
  const { deleteConsentAction } = await import("@/features/consent/server/actions");

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "ConsentIsoB",
      fullName: "ConsentIsoB",
      phone: "+79993334441",
      clientStatus: "new_lead",
    })
    .returning();

  const [mediaB] = await db
    .insert(s.media)
    .values({
      studioId: studioB,
      clientId: clientB.id,
      type: "consent",
      url: "https://example.test/consent.jpg",
      createdById: userB,
    })
    .returning();

  const [consentB] = await db
    .insert(s.consents)
    .values({
      studioId: studioB,
      clientId: clientB.id,
      mediaId: mediaB.id,
      consentType: "pmu_general",
      signedAt: new Date(),
    })
    .returning();

  try {
    cookieState.value = studioA;
    await expect(deleteConsentAction(consentB.id, clientB.id)).rejects.toThrow();

    const [afterConsent] = await db.select().from(s.consents).where(eq(s.consents.id, consentB.id));
    expect(afterConsent).toBeDefined();
    expect(afterConsent.studioId).toBe(studioB);
  } finally {
    await db.delete(s.consents).where(eq(s.consents.id, consentB.id));
    await db.delete(s.media).where(eq(s.media.id, mediaB.id));
    await db.delete(s.clients).where(eq(s.clients.id, clientB.id));
  }
});

test("55. Mutation Isolation - Media: Studio A context cannot delete Media belonging to Studio B", async () => {
  const { deleteMediaAction } = await import("@/features/media/server/actions");

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "MediaIsoB",
      fullName: "MediaIsoB",
      phone: "+79993334442",
      clientStatus: "new_lead",
    })
    .returning();

  const [mediaB] = await db
    .insert(s.media)
    .values({
      studioId: studioB,
      clientId: clientB.id,
      type: "before",
      url: "https://example.test/isob.jpg",
      createdById: userB,
    })
    .returning();

  try {
    cookieState.value = studioA;
    await expect(deleteMediaAction(mediaB.id)).rejects.toThrow();

    const [afterMedia] = await db.select().from(s.media).where(eq(s.media.id, mediaB.id));
    expect(afterMedia.deletedAt).toBeNull();
  } finally {
    await db.delete(s.media).where(eq(s.media.id, mediaB.id));
    await db.delete(s.clients).where(eq(s.clients.id, clientB.id));
  }
});

test("56. Mutation Isolation - Settings / Team: Studio A context cannot alter membership or assignments in B", async () => {
  const { assignClientMaster } = await import("@/features/settings/server/role-management");

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "TeamIsoB",
      fullName: "TeamIsoB",
      phone: "+79993334443",
      clientStatus: "new_lead",
    })
    .returning();

  const [masterA] = await db
    .insert(s.masters)
    .values({
      studioId: studioA,
      displayName: "TeamMasterA",
      calendarColor: "#778899",
      isActive: true,
    })
    .returning();

  try {
    cookieState.value = studioA;
    // Cross-studio client assignment must fail
    await expect(
      assignClientMaster({
        clientId: clientB.id,
        masterId: masterA.id,
        expectedMasterId: null,
        reason: "Cross-studio assignment attempt",
      })
    ).rejects.toThrow();

    const [afterClient] = await db.select().from(s.clients).where(eq(s.clients.id, clientB.id));
    expect(afterClient.assignedMasterId).toBeNull();
  } finally {
    await db.delete(s.masters).where(eq(s.masters.id, masterA.id));
    await db.delete(s.clients).where(eq(s.clients.id, clientB.id));
  }
});

test("57. Mutation Isolation - Treatment Cycle: Studio A context cannot mutate Cycle belonging to Studio B", async () => {
  const { transitionCycleAction } = await import("@/features/treatment-cycles/server/actions");

  const [clientB] = await db
    .insert(s.clients)
    .values({
      studioId: studioB,
      firstName: "CycleIsoB",
      fullName: "CycleIsoB",
      phone: "+79993334444",
      clientStatus: "new_lead",
    })
    .returning();

  const [cycleB] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId: studioB,
      clientId: clientB.id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
      version: 1,
    })
    .returning();

  try {
    cookieState.value = studioA;
    await expect(
      transitionCycleAction(
        { id: cycleB.id, expectedVersion: 1, to: "qualification", reason: "Cross-studio transition attempt" },
        randomUUID()
      )
    ).rejects.toThrow();

    const [afterCycle] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycleB.id));
    expect(afterCycle.stage).toBe("new_lead");
    expect(afterCycle.version).toBe(1);
  } finally {
    await db.delete(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycleB.id));
    await db.delete(s.clients).where(eq(s.clients.id, clientB.id));
  }
});

test("58. Mutation Isolation - Custom DENY override rejects mutation and leaves domain row unchanged", async () => {
  const { createClientAction } = await import("@/features/clients/server/actions");

  const [perm] = await db.select().from(s.permissions).where(eq(s.permissions.code, "CLIENT_CREATE"));
  expect(perm).toBeDefined();

  // Insert explicit custom DENY override for user in Studio A
  await db.insert(s.userCustomPermissions).values({
    studioId: studioA,
    userId: userA,
    permissionId: perm.id,
    effect: "deny",
  });

  try {
    cookieState.value = studioA;
    await expect(
      createClientAction(
        { firstName: "DeniedClient", phone: "+79995551234" },
        randomUUID()
      )
    ).rejects.toThrow();

    const createdRows = await db
      .select()
      .from(s.clients)
      .where(and(eq(s.clients.studioId, studioA), eq(s.clients.firstName, "DeniedClient")));
    expect(createdRows).toHaveLength(0);
  } finally {
    await db
      .delete(s.userCustomPermissions)
      .where(
        and(
          eq(s.userCustomPermissions.studioId, studioA),
          eq(s.userCustomPermissions.userId, userA),
          eq(s.userCustomPermissions.permissionId, perm.id)
        )
      );
  }
});

test("59. Mutation Isolation - Missing cookie rejects browser mutation before DB change", async () => {
  const { createClientAction } = await import("@/features/clients/server/actions");

  cookieState.value = undefined;
  await expect(
    createClientAction(
      { firstName: "MissingCookieClient", phone: "+79995550001" },
      randomUUID()
    )
  ).rejects.toThrow();

  const rows = await db
    .select()
    .from(s.clients)
    .where(eq(s.clients.firstName, "MissingCookieClient"));
  expect(rows).toHaveLength(0);
});

test("60. Mutation Isolation - Stale / malformed cookie rejects browser mutation before DB change", async () => {
  const { createClientAction } = await import("@/features/clients/server/actions");

  cookieState.value = "malformed-not-a-uuid";
  await expect(
    createClientAction(
      { firstName: "MalformedCookieClient", phone: "+79995550002" },
      randomUUID()
    )
  ).rejects.toThrow();

  const rows = await db
    .select()
    .from(s.clients)
    .where(eq(s.clients.firstName, "MalformedCookieClient"));
  expect(rows).toHaveLength(0);
});

test("61. Mutation Isolation - Revoked membership immediately before mutation fails closed", async () => {
  const { createClientAction } = await import("@/features/clients/server/actions");

  // Deactivate membership in studioA
  await db
    .update(s.studioMembers)
    .set({ isActive: false })
    .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));

  try {
    cookieState.value = studioA;
    await expect(
      createClientAction(
        { firstName: "RevokedMemberClient", phone: "+79995550003" },
        randomUUID()
      )
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(s.clients)
      .where(eq(s.clients.firstName, "RevokedMemberClient"));
    expect(rows).toHaveLength(0);
  } finally {
    // Restore membership
    await db
      .update(s.studioMembers)
      .set({ isActive: true })
      .where(and(eq(s.studioMembers.studioId, studioA), eq(s.studioMembers.userId, userA)));
  }
});
