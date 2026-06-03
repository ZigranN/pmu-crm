import { studioMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  STUDIO_ADMIN: "STUDIO_ADMIN",
  MASTER: "MASTER",
  ASSISTANT: "ASSISTANT",
  CLIENT: "CLIENT",
} as const;

export type RoleCode = keyof typeof ROLES;

/**
 * Проверяет, есть ли у пользователя определенная роль в студии
 */
export async function hasRole(dbInstance: any, userId: string, studioId: string, roleCode: RoleCode) {
  const member = await dbInstance.query.studioMembers.findFirst({
    where: and(
      eq(studioMembers.userId, userId),
      eq(studioMembers.studioId, studioId),
      eq(studioMembers.isActive, true)
    ),
    with: {
      role: true,
    },
  });

  if (!member) return false;
  
  const role = member.role as any;
  if (role.code === ROLES.SUPER_ADMIN) return true;
  return role.code === roleCode;
}

export function canAccessDashboard(role?: string | null) {
  if (!role) return false;
  return [ROLES.SUPER_ADMIN, ROLES.STUDIO_ADMIN, ROLES.MASTER, ROLES.ASSISTANT].includes(role as any);
}
