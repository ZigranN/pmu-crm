import { redirect } from "next/navigation";
import { db } from "@/db";
import { studioMembers, roles, user, masters } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireStudioContext } from "@/server/auth/context";
import { getStudioRole, normalizeRole } from "@/lib/roles";
import { RoleManagement } from "@/features/settings/components/role-management";
export default async function TeamPage() {
  const context = await requireStudioContext();
  if (await getStudioRole(db, context.userId, context.studioId) !== "OWNER") redirect("/dashboard");
  const profiles = await db.select({ id: masters.id, displayName: masters.displayName, userId: masters.userId }).from(masters)
    .where(and(eq(masters.studioId, context.studioId), isNull(masters.deletedAt), eq(masters.isActive, true)));
  const rows = await db.select({ email: user.email, name: user.name, userId: user.id, role: roles.code, active: studioMembers.isActive }).from(studioMembers)
    .innerJoin(roles, eq(roles.id, studioMembers.roleId)).innerJoin(user, eq(user.id, studioMembers.userId)).where(eq(studioMembers.studioId, context.studioId));
  return <div className="space-y-6"><h1 className="text-2xl font-bold">Участники и роли</h1><RoleManagement masters={profiles}
    members={rows.map(m => ({ ...m, role: normalizeRole(m.role) ?? m.role, masterId: profiles.find(p => p.userId === m.userId)?.id ?? null }))} /></div>;
}
