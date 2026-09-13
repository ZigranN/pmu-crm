import { studioMembers, roles, studios } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const ROLES = { OWNER: "OWNER", ADMIN: "ADMIN", MASTER: "MASTER", AI_SYSTEM: "AI_SYSTEM" } as const;
export type RoleCode = keyof typeof ROLES;

// Only studio memberships carry authority; user.role is legacy auth metadata.
export const LEGACY_ROLE_MAPPING: Readonly<Record<string, RoleCode | null>> = {
  SUPER_ADMIN: "OWNER", STUDIO_ADMIN: "OWNER", ASSISTANT: "ADMIN", CLIENT: null,
};
export function normalizeRole(code: string): RoleCode | null {
  if (Object.hasOwn(ROLES, code)) return code as RoleCode;
  return Object.hasOwn(LEGACY_ROLE_MAPPING, code) ? LEGACY_ROLE_MAPPING[code] : null;
}

export async function getStudioRole(dbInstance: any, userId: string, studioId: string): Promise<string | null> {
  const member = await dbInstance.query.studioMembers.findFirst({
    where: and(eq(studioMembers.userId, userId), eq(studioMembers.studioId, studioId), eq(studioMembers.isActive, true)),
  });
  if (!member) return null;
  const studio = await dbInstance.query.studios.findFirst({ where: and(eq(studios.id, studioId), eq(studios.isActive, true)) });
  if (!studio) return null;
  const role = await dbInstance.query.roles.findFirst({ where: eq(roles.id, member.roleId) });
  return role ? normalizeRole(role.code) ?? role.code : null;
}

export async function hasRole(dbInstance: any, userId: string, studioId: string, roleCode: RoleCode) {
  try { return await getStudioRole(dbInstance, userId, studioId) === roleCode; }
  catch { return false; }
}

export function canAccessDashboard(role?: string | null) {
  const normalized = role ? normalizeRole(role) : null;
  return normalized === "OWNER" || normalized === "ADMIN" || normalized === "MASTER";
}
