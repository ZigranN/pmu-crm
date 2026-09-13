"use server";
import { writeActivity } from "@/server/services/activity.service";
import { writeAudit } from "@/server/services/audit-log.service";
import { db } from "@/db";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { enqueue } from "@/server/events/outbox";
import { clients, clientStatusHistory } from "@/db/schema";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { resourceScope } from "@/server/auth/scopes";
import { lockClient } from "@/server/commands/ownership";
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
export async function createClientAction(input: ClientSchema, requestKey: string) {
  const context = await requireStudioPermission("CLIENT_CREATE");
  const data = parseClient(input);
  // Persist only a result reference; replay never returns an old personal-data snapshot.
  const result = await idempotentCommand(context, "CLIENT_CREATE", "client.create.v1", requestKey,
    JSON.parse(JSON.stringify(data)) as Json, async (tx, commandId) => {
      const [created] = await tx.insert(clients).values({ ...data, studioId: context.studioId }).returning();
      await writeActivity(tx, { ...context, clientId: created.id, type: "client_created", title: "Клиент создан" });
      await writeAudit(tx, { ...context, action: "client_created", entityType: "client", entityId: created.id,
        before: null, after: created, reason: "command:client_created", metadata: { commandId } });
      await enqueue(tx, { studioId: context.studioId, eventKey: commandId, handler: "client.created.v1" }, { clientId: created.id });
      return { id: created.id };
    }, async (tx, result) => { await lockClient(tx, result.id, context.studioId, context.userId, true, "CLIENT_CREATE"); });
  revalidatePath("/clients");
  return result;
}
export async function updateClientAction(id: string, input: ClientSchema) {
  const context = await requireStudioPermission("CLIENT_UPDATE");
  const data = parseClient(input);
  const result = await db.transaction(async tx => {
    const before = await lockClient(tx, id, context.studioId, context.userId, false, "CLIENT_UPDATE");
    const [after] = await tx.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, before.id)).returning();
    if (before.clientStatus !== after.clientStatus) {
      await tx.insert(clientStatusHistory).values({
      studioId: context.studioId, clientId: id, oldStatus: before.clientStatus, newStatus: after.clientStatus, changedById: context.userId,
    });
      await writeActivity(tx, { ...context, clientId: id, type: "client_status_changed", title: "Статус клиента изменён", metadata: { before: before.clientStatus, after: after.clientStatus } });
      await writeAudit(tx, { ...context, action: "client_status_changed", entityType: "client", entityId: id, before: { status: before.clientStatus }, after: { status: after.clientStatus }, reason: "command:client_status_changed" });
    }
    await writeActivity(tx, { ...context, clientId: id, type: "client_updated", title: "Данные клиента обновлены",
      metadata: { oldStatus: before.clientStatus, newStatus: after.clientStatus } });
    await writeAudit(tx, { ...context, action: "client_updated", entityType: "client", entityId: id,
      before, after, reason: "command:client_updated" });
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
    const [after] = await tx.update(clients).set({ deletedAt: archived ? new Date() : null, deletedById: archived ? context.userId : null, updatedAt: new Date() }).where(eq(clients.id, before.id)).returning();
    await writeActivity(tx, { ...context, clientId: id, type: archived ? "client_archived" : "client_restored", title: archived ? "Клиент архивирован" : "Клиент восстановлен" });
    await writeAudit(tx, { ...context, action: archived ? "client_archived" : "client_restored", entityType: "client", entityId: id, before, after, reason: archived ? "command:client_archived" : "command:client_restored" });
  });
  revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
}
export async function archiveClientAction(id: string) { await archiveState(id, true); }
export async function restoreClientAction(id: string) { await archiveState(id, false); }
