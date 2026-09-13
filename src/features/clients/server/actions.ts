"use server";
import { db } from "@/db";
import { clients, clientStatusHistory, activityEvents, auditLogs } from "@/db/schema";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { lockStudioAccess, resourceScope } from "@/server/auth/scopes";
import { lockClient } from "@/server/commands/ownership";
import { hasPermission } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

function parseClient(input: ClientSchema) {
  const validated = clientSchema.parse(input);
  const phone = normalizePhone(validated.phone);
  return { ...validated, phone, whatsapp: validated.whatsapp ? normalizePhone(validated.whatsapp) : phone,
    fullName: `${validated.firstName} ${validated.lastName || ""}`.trim(),
    clientStatus: validated.clientStatus as typeof clients.$inferInsert.clientStatus,
    tags: Array.isArray(validated.tags) ? validated.tags.join(",") : validated.tags };
}
export async function createClientAction(input: ClientSchema) {
  const context = await requireStudioPermission("CLIENT_CREATE");
  const data = parseClient(input);
  const result = await db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, "CLIENT_CREATE")) throw new Error("Permission denied");
    const [created] = await tx.insert(clients).values({ ...data, studioId: context.studioId }).returning();
    await tx.insert(activityEvents).values({ ...context, clientId: created.id, type: "client_created", title: "Клиент создан" });
    await tx.insert(auditLogs).values({ ...context, action: "client_created", entityType: "client", entityId: created.id });
    return created;
  });
  revalidatePath("/clients");
  return result;
}
export async function updateClientAction(id: string, input: ClientSchema) {
  const context = await requireStudioPermission("CLIENT_UPDATE");
  const data = parseClient(input);
  const result = await db.transaction(async tx => {
    const before = await lockClient(tx, id, context.studioId, context.userId, false, "CLIENT_UPDATE");
    const [after] = await tx.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, before.id)).returning();
    if (before.clientStatus !== after.clientStatus) await tx.insert(clientStatusHistory).values({
      studioId: context.studioId, clientId: id, oldStatus: before.clientStatus, newStatus: after.clientStatus, changedById: context.userId,
    });
    await tx.insert(activityEvents).values({ ...context, clientId: id, type: "client_updated", title: "Данные клиента обновлены",
      metadata: { oldStatus: before.clientStatus, newStatus: after.clientStatus } });
    await tx.insert(auditLogs).values({ ...context, action: "client_updated", entityType: "client", entityId: id,
      metadata: { before, after } });
    const scope = await resourceScope(context, tx);
    return { ...after, ltvCents: scope.isMaster ? null : after.ltvCents };
  });
  revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
  return result;
}
async function archiveState(id: string, archived: boolean) {
  const permission = archived ? "CLIENT_ARCHIVE" : "CLIENT_UPDATE";
  const context = await requireStudioPermission(permission);
  await db.transaction(async tx => {
    const before = await lockClient(tx, id, context.studioId, context.userId, !archived, permission);
    await tx.update(clients).set({ deletedAt: archived ? new Date() : null, deletedById: archived ? context.userId : null, updatedAt: new Date() }).where(eq(clients.id, before.id));
    await tx.insert(auditLogs).values({ ...context, action: archived ? "client_archived" : "client_restored", entityType: "client", entityId: id });
  });
  revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
}
export async function archiveClientAction(id: string) { await archiveState(id, true); }
export async function restoreClientAction(id: string) { await archiveState(id, false); }
