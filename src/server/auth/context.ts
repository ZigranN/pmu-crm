import "server-only";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { studioMembers, studios, roles } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasPermission, type PermissionCode } from "@/lib/permissions";
import { normalizeRole } from "@/lib/roles";
import { z } from "zod";
import type { Transaction } from "@/server/commands/ownership";

export const ACTIVE_STUDIO_COOKIE = "pmu_active_studio";

export type ActiveStudioCookieState =
  | { kind: "missing" }
  | { kind: "valid"; studioId: string }
  | { kind: "invalid" };

export interface StudioContext {
  userId: string;
  userEmail?: string;
  studioId: string;
  membershipId: string;
  role: string;
  studioName: string;
  studioSlug?: string;
}

export interface UserActiveStudio {
  studioId: string;
  studioName: string;
  studioSlug?: string;
  membershipId: string;
  role: string;
}

export class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
  constructor(message = "AUTH_REQUIRED") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class StudioContextRequiredError extends Error {
  readonly code = "STUDIO_CONTEXT_REQUIRED";
  constructor(message = "STUDIO_CONTEXT_REQUIRED") {
    super(message);
    this.name = "StudioContextRequiredError";
  }
}

export class StudioContextStaleError extends Error {
  readonly code = "STUDIO_CONTEXT_STALE";
  constructor(message = "STUDIO_CONTEXT_STALE") {
    super(message);
    this.name = "StudioContextStaleError";
  }
}

export class StudioAccessDeniedError extends Error {
  readonly code = "STUDIO_ACCESS_DENIED";
  constructor(message = "STUDIO_ACCESS_DENIED") {
    super(message);
    this.name = "StudioAccessDeniedError";
  }
}

export class ForbiddenPermissionError extends Error {
  readonly code = "FORBIDDEN_PERMISSION";
  constructor(message = "FORBIDDEN_PERMISSION") {
    super(message);
    this.name = "ForbiddenPermissionError";
  }
}

export async function readSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function readActiveStudioCookieState(): Promise<ActiveStudioCookieState> {
  try {
    const nextHeaders = await import("next/headers");
    if (!nextHeaders || typeof nextHeaders.cookies !== "function") {
      return { kind: "missing" };
    }
    const cookieStore = await nextHeaders.cookies();
    if (!cookieStore || typeof cookieStore.get !== "function") {
      return { kind: "missing" };
    }
    const raw = cookieStore.get(ACTIVE_STUDIO_COOKIE)?.value;
    if (!raw) {
      return { kind: "missing" };
    }
    if (!z.string().uuid().safeParse(raw).success) {
      return { kind: "invalid" };
    }
    return { kind: "valid", studioId: raw };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
      const msg = (err as { message: string }).message;
      if (msg.includes('No "cookies" export')) {
        return { kind: "missing" };
      }
    }
    throw err;
  }
}

export async function requireAuthenticatedUser() {
  const session = await readSession();
  if (!session?.user?.id) {
    throw new AuthRequiredError("AUTH_REQUIRED");
  }
  return session.user;
}

/**
 * Authoritative single membership validator.
 * Verifies valid UUID, active membership, and active studio.
 * Does NOT perform static role-based capability checks or first-row fallback.
 */
export async function getActiveStudioMembership(
  userId: string,
  studioId: string,
  executor: typeof db | Transaction = db
): Promise<StudioContext | null> {
  if (!studioId || !z.string().uuid().safeParse(studioId).success) {
    return null;
  }
  const member = await executor.query.studioMembers.findFirst({
    where: and(
      eq(studioMembers.userId, userId),
      eq(studioMembers.studioId, studioId),
      eq(studioMembers.isActive, true)
    ),
  });
  if (!member) return null;

  const studio = await executor.query.studios.findFirst({
    where: and(eq(studios.id, studioId), eq(studios.isActive, true)),
  });
  if (!studio) return null;

  const roleRecord = await executor.query.roles.findFirst({
    where: eq(roles.id, member.roleId),
  });
  const role = roleRecord ? (normalizeRole(roleRecord.code) ?? roleRecord.code) : "CLIENT";

  return {
    userId,
    studioId,
    membershipId: member.id,
    role,
    studioName: studio.name,
    studioSlug: studio.slug ?? undefined,
  };
}

export async function requireActiveStudioMembership(
  userId: string,
  studioId: string,
  executor: typeof db | Transaction = db
): Promise<StudioContext> {
  const context = await getActiveStudioMembership(userId, studioId, executor);
  if (!context) {
    throw new StudioAccessDeniedError("STUDIO_ACCESS_DENIED");
  }
  return context;
}

/**
 * Lists all active studio memberships for an authenticated user where the studio is also active.
 * Deterministically sorted for UI display.
 * NOTE: The returned list and ordering is strictly for UI selection; it is NEVER an authorization fallback.
 */
export async function getUserActiveStudios(
  userId?: string,
  executor: typeof db | Transaction = db
): Promise<UserActiveStudio[]> {
  const targetUserId = userId ?? (await requireAuthenticatedUser()).id;
  const members = await executor.query.studioMembers.findMany({
    where: and(
      eq(studioMembers.userId, targetUserId),
      eq(studioMembers.isActive, true)
    ),
    orderBy: [asc(studioMembers.createdAt), asc(studioMembers.id)],
  });

  if (!members.length) return [];

  const results: UserActiveStudio[] = [];
  for (const member of members) {
    const studio = await executor.query.studios.findFirst({
      where: and(eq(studios.id, member.studioId), eq(studios.isActive, true)),
    });
    if (!studio) continue;

    const roleRecord = await executor.query.roles.findFirst({
      where: eq(roles.id, member.roleId),
    });
    const role = roleRecord ? (normalizeRole(roleRecord.code) ?? roleRecord.code) : "CLIENT";

    results.push({
      studioId: studio.id,
      studioName: studio.name,
      studioSlug: studio.slug ?? undefined,
      membershipId: member.id,
      role,
    });
  }

  return results.sort(
    (a, b) => a.studioName.localeCompare(b.studioName) || a.studioId.localeCompare(b.studioId)
  );
}

/**
 * Browser active Studio context resolver.
 * Reads pmu_active_studio cookie and validates active membership/studio.
 */
export async function requireBrowserStudioContext(): Promise<StudioContext> {
  const user = await requireAuthenticatedUser();
  const cookieState = await readActiveStudioCookieState();

  if (cookieState.kind === "missing") {
    throw new StudioContextRequiredError("STUDIO_CONTEXT_REQUIRED");
  }
  if (cookieState.kind === "invalid") {
    throw new StudioContextStaleError("STUDIO_CONTEXT_STALE");
  }

  const membership = await getActiveStudioMembership(user.id, cookieState.studioId);
  if (!membership) {
    throw new StudioContextStaleError("STUDIO_CONTEXT_STALE");
  }

  return {
    ...membership,
    userEmail: user.email ?? undefined,
  };
}

/**
 * Explicit active Studio context resolver for API / background callers.
 * Validates active membership and active studio for the specified studioId.
 */
export async function requireStudioContextFor(
  userId: string,
  studioId: string,
  executor: typeof db | Transaction = db
): Promise<StudioContext> {
  if (!userId) {
    throw new AuthRequiredError("AUTH_REQUIRED");
  }
  if (!studioId || !z.string().uuid().safeParse(studioId).success) {
    throw new StudioAccessDeniedError("STUDIO_ACCESS_DENIED");
  }
  const membership = await getActiveStudioMembership(userId, studioId, executor);
  if (!membership) {
    throw new StudioAccessDeniedError("STUDIO_ACCESS_DENIED");
  }
  return membership;
}

/**
 * Browser permission check.
 * Resolves browser studio context and executes dynamic capability check via canonical hasPermission engine.
 */
export async function requireBrowserStudioPermission(
  permission: PermissionCode
): Promise<StudioContext> {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, permission);
  if (!allowed) {
    throw new ForbiddenPermissionError("FORBIDDEN_PERMISSION");
  }
  return context;
}

/**
 * Explicit permission check for API / background callers.
 * Resolves explicit studio context and executes dynamic capability check via canonical hasPermission engine.
 */
export async function requireStudioPermissionFor(
  userId: string,
  studioId: string,
  permission: PermissionCode,
  executor: typeof db | Transaction = db
): Promise<StudioContext> {
  const context = await requireStudioContextFor(userId, studioId, executor);
  const allowed = await hasPermission(executor, context.userId, context.studioId, permission);
  if (!allowed) {
    throw new ForbiddenPermissionError("FORBIDDEN_PERMISSION");
  }
  return context;
}

// ---------------------------------------------------------------------------
// TRANSITIONAL / DEPRECATED LEGACY HELPERS
// (Kept for backwards compatibility until callers are migrated in PHASE 1.1C)
// ---------------------------------------------------------------------------

/**
 * @deprecated Transitional legacy helper with first-active fallback. Will be removed in PHASE 1.1C.
 */
async function resolveStudio(userId: string, requestedStudioId?: string) {
  const memberships = await db.query.studioMembers.findMany({
    where: and(
      eq(studioMembers.userId, userId),
      eq(studioMembers.isActive, true),
      requestedStudioId ? eq(studioMembers.studioId, requestedStudioId) : undefined
    ),
    orderBy: [asc(studioMembers.createdAt), asc(studioMembers.id)],
  });
  for (const member of memberships) {
    const studio = await db.query.studios.findFirst({
      where: and(eq(studios.id, member.studioId), eq(studios.isActive, true)),
    });
    if (studio) return studio.id;
  }
  return undefined;
}

/**
 * @deprecated Transitional legacy helper. Will be removed in PHASE 1.1C.
 */
export async function currentStudioForSessionUser(userId: string) {
  const session = await readSession();
  if (!session || session.user.id !== userId) return undefined;
  return resolveStudio(session.user.id);
}

/**
 * @deprecated Transitional legacy helper. Will be removed in PHASE 1.1C.
 */
export async function requireStudioContext(requestedStudioId?: string) {
  const session = await readSession();
  if (!session) throw new Error("Unauthorized");
  if (requestedStudioId !== undefined && !z.string().uuid().safeParse(requestedStudioId).success) {
    throw new Error("Permission denied");
  }
  const studioId = await resolveStudio(session.user.id, requestedStudioId);
  if (!studioId) throw new Error("Permission denied");
  return { userId: session.user.id, studioId };
}

/**
 * @deprecated Transitional legacy helper. Will be removed in PHASE 1.1C.
 */
export async function requireStudioPermission(permission: PermissionCode, requestedStudioId?: string) {
  const context = await requireStudioContext(requestedStudioId);
  if (!(await hasPermission(db, context.userId, context.studioId, permission))) {
    throw new Error("Permission denied");
  }
  return context;
}
