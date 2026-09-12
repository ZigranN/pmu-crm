import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { studioMembers, studios } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { hasPermission, type PermissionCode } from "@/lib/permissions";
import { z } from "zod";

export async function readSession() {
  return auth.api.getSession({ headers: await headers() });
}

// Internal server-only helper, never exposed as a Server Action.
async function resolveStudio(userId: string, requestedStudioId?: string) {
  const memberships = await db.query.studioMembers.findMany({
    where: and(eq(studioMembers.userId, userId), eq(studioMembers.isActive, true),
      requestedStudioId ? eq(studioMembers.studioId, requestedStudioId) : undefined),
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

export async function currentStudioForSessionUser(userId: string) {
  const session = await readSession();
  if (!session || session.user.id !== userId) return undefined;
  return resolveStudio(session.user.id);
}

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

export async function requireStudioPermission(permission: PermissionCode, requestedStudioId?: string) {
  const context = await requireStudioContext(requestedStudioId);
  if (!await hasPermission(db, context.userId, context.studioId, permission)) {
    throw new Error("Permission denied");
  }
  return context;
}
