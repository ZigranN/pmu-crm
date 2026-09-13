"use server";
import { writeActivity } from "@/server/services/activity.service";
import { writeAudit } from "@/server/services/audit-log.service";
import { db } from "@/db";
import { studioMembers, roles, user, masters, clients, clientAssignments } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStudioContext } from "@/server/auth/context";
import { lockStudioAccess } from "@/server/auth/scopes";
import { normalizeRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";

const membershipInput = z.object({ email: z.string().email(), role: z.enum(["OWNER", "ADMIN", "MASTER"]),
  active: z.boolean(), masterId: z.string().uuid().nullable(), reason: z.string().trim().min(3).max(1000) }).strict();

export async function saveMembership(input: z.infer<typeof membershipInput>) {
  const data = membershipInput.parse(input);
  const context = await requireStudioContext();
  const { studioId } = context;
  await db.transaction(async tx => {
    const actor = await lockStudioAccess(tx, context);
    if (actor.role !== "OWNER") throw new Error("Permission denied");
    const target = await tx.query.user.findFirst({ where: eq(user.email, data.email.trim().toLowerCase()) });
    if (!target) throw new Error("Сначала зарегистрируйте пользователя с этим email");
    const all = await tx.select({ member: studioMembers, role: roles.code }).from(studioMembers)
      .innerJoin(roles, eq(roles.id, studioMembers.roleId)).where(eq(studioMembers.studioId, studioId));
    const before = all.find(row => row.member.userId === target.id);
    if (before?.member.isActive && normalizeRole(before.role) === "OWNER" && (!data.active || data.role !== "OWNER") &&
      !all.some(row => row.member.userId !== target.id && row.member.isActive && normalizeRole(row.role) === "OWNER")) {
      throw new Error("Нельзя отключить последнего владельца студии");
    }
    const role = await tx.query.roles.findFirst({ where: eq(roles.code, data.role) });
    if (!role) throw new Error("Apply role migrations first");
    const oldBindings = await tx.select().from(masters).where(and(eq(masters.studioId, studioId), eq(masters.userId, target.id)));
    if (data.masterId) {
      if (!data.active || data.role === "ADMIN") throw new Error("Привязка мастера доступна активному Master или Owner");
      const master = await tx.query.masters.findFirst({ where: and(eq(masters.id, data.masterId), eq(masters.studioId, studioId), eq(masters.isActive, true), isNull(masters.deletedAt)) });
      if (!master || (master.userId && master.userId !== target.id)) throw new Error("Мастер недоступен или уже привязан к другому аккаунту");
    }
    await tx.update(masters).set({ userId: null, updatedAt: new Date() }).where(and(eq(masters.studioId, studioId), eq(masters.userId, target.id)));
    if (data.masterId) await tx.update(masters).set({ userId: target.id, updatedAt: new Date() }).where(and(eq(masters.id, data.masterId), eq(masters.studioId, studioId)));
    const [after] = await tx.insert(studioMembers).values({ studioId, userId: target.id, roleId: role.id, isActive: data.active })
      .onConflictDoUpdate({ target: [studioMembers.studioId, studioMembers.userId], set: { roleId: role.id, isActive: data.active } }).returning();
    await writeAudit(tx, { studioId, userId: actor.userId, action: "membership_changed", entityType: "studio_member", entityId: after.id,
      before: before ? { ...before.member, role: before.role, masterIds: oldBindings.map(m => m.id) } : null, after: { ...after, role: data.role, masterId: data.masterId }, reason: data.reason, reasonSource: "user" });
  });
  revalidatePath("/", "layout");
}

const assignmentInput = z.object({ clientId: z.string().uuid(), masterId: z.string().uuid().nullable(),
  expectedMasterId: z.string().uuid().nullable(), reason: z.string().trim().min(3).max(1000) }).strict();
export async function assignClientMaster(input: z.infer<typeof assignmentInput>) {
  const data = assignmentInput.parse(input);
  const context = await requireStudioContext();
  const { studioId } = context;
  await db.transaction(async tx => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER", "ADMIN"].includes(actor.role) || !await hasPermission(tx, actor.userId, studioId, "CLIENT_UPDATE")) throw new Error("Permission denied");
    const [before] = await tx.select().from(clients).where(and(eq(clients.id, data.clientId), eq(clients.studioId, studioId), isNull(clients.deletedAt))).for("update");
    if (!before) throw new Error("Client not found");
    if (before.assignedMasterId !== data.expectedMasterId) throw new Error("Назначение уже изменилось. Обновите страницу");
    if (data.masterId) {
      const master = await tx.query.masters.findFirst({ where: and(eq(masters.id, data.masterId), eq(masters.studioId, studioId), eq(masters.isActive, true), isNull(masters.deletedAt)) });
      if (!master) throw new Error("Master not found");
    }
    if (before.assignedMasterId === data.masterId) return;
    await tx.update(clients).set({ assignedMasterId: data.masterId, updatedAt: new Date() }).where(eq(clients.id, before.id));
    const [history] = await tx.insert(clientAssignments).values({ studioId, clientId: before.id, previousMasterId: before.assignedMasterId,
      masterId: data.masterId, changedById: actor.userId, reason: data.reason }).returning();
    await writeActivity(tx, { studioId, userId: actor.userId, clientId: before.id, type: "client_master_assigned",
      title: "Назначение мастера изменено", description: data.reason, metadata: { kind: "master_assignment", previousMasterId: before.assignedMasterId, masterId: data.masterId } });
    await writeAudit(tx, { studioId, userId: actor.userId, action: "client_master_assigned", entityType: "client", entityId: before.id,
      before: { assignedMasterId: before.assignedMasterId }, after: { assignedMasterId: data.masterId }, reason: data.reason, reasonSource: "user", metadata: { historyId: history.id } });
  });
  revalidatePath(`/clients/${data.clientId}`);
  revalidatePath("/clients");
}
