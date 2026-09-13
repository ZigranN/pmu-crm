"use server";
import { writeActivity } from "@/server/services/activity.service";
import { writeAudit } from "@/server/services/audit-log.service";
import { db } from "@/db";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { enqueue } from "@/server/events/outbox";
import { clients, clientStatusHistory, clientDuplicateDecisions } from "@/db/schema";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { resourceScope } from "@/server/auth/scopes";
import { lockClient } from "@/server/commands/ownership";
import { canonicalPhone, canonicalEmail, canonicalInstagram } from "../contacts";
import { findDuplicates, DuplicateReviewRequired, duplicateDecisionSchema, type DuplicateDecision } from "./deduplication";
import { reviewClientDuplicates } from "./duplicate-actions";
import { getStudioRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

function parseClient(input: ClientSchema, before?: typeof clients.$inferSelect) {
  const validated = clientSchema.parse(input);
  function contact(value: string, old: string | null | undefined, normalize: (value: string) => string | null, label: string) {
    if (before && value === old) return value; // Preserve unchanged ambiguous legacy values.
    const key = normalize(value); if (!key) throw new Error(`Укажите корректный ${label}`); return key;
  }
  const phone = contact(validated.phone, before?.phone, canonicalPhone, "телефон с кодом страны (+39…)");
  return { ...validated, phone,
    ...(validated.whatsapp !== undefined || !before ? { whatsapp: validated.whatsapp ? contact(validated.whatsapp, before?.whatsapp, canonicalPhone, "WhatsApp с кодом страны") : phone } : {}),
    ...(validated.email !== undefined ? { email: validated.email ? contact(validated.email, before?.email, canonicalEmail, "email") : "" } : {}),
    ...(validated.instagram !== undefined ? { instagram: validated.instagram ? contact(validated.instagram, before?.instagram, canonicalInstagram, "Instagram handle или ссылку на профиль") : "" } : {}),
    fullName: `${validated.firstName} ${validated.lastName || ""}`.trim(),
    clientStatus: validated.clientStatus as typeof clients.$inferInsert.clientStatus,
    tags: Array.isArray(validated.tags) ? validated.tags.join(",") : validated.tags };
}
export async function createClientAction(input: ClientSchema, requestKey: string, decision?: DuplicateDecision) {
  const context = await requireStudioPermission("CLIENT_CREATE");
  const data = parseClient(input);
  const confirmation = decision ? duplicateDecisionSchema.parse(decision) : undefined;
  // Persist only a result reference; replay never returns an old personal-data snapshot.
  const result = await idempotentCommand(context, "CLIENT_CREATE", "client.create.v1", requestKey,
    JSON.parse(JSON.stringify(data)) as Json, async (tx, commandId) => {
      const review = await findDuplicates(tx, context, data);
      if (review.truncated || (review.candidates.length && (!confirmation || confirmation.token !== review.token))) throw new DuplicateReviewRequired();
      if (review.candidates.length) {
        const role = await getStudioRole(tx, context.userId, context.studioId);
        if ((role !== "OWNER" && role !== "ADMIN") || !await hasPermission(tx, context.userId, context.studioId, "CLIENT_READ")) throw new Error("Permission denied");
      }
      const [created] = await tx.insert(clients).values({ ...data, studioId: context.studioId }).returning();
      await writeActivity(tx, { ...context, clientId: created.id, type: "client_created", title: "Клиент создан" });
      await writeAudit(tx, { ...context, action: "client_created", entityType: "client", entityId: created.id,
        before: null, after: created, reason: "command:client_created", metadata: { commandId } });
      if (review.candidates.length && confirmation) {
        const [accepted] = await tx.insert(clientDuplicateDecisions).values({ studioId: context.studioId, clientId: created.id, actorId: context.userId,
          reason: confirmation.reason, reviewToken: review.token, matches: review.candidates.map(({ id, level, reasons }) => ({ id, level, reasons })) }).returning();
        await writeAudit(tx, { ...context, action: "client_duplicate_accepted", entityType: "client", entityId: created.id, before: null, after: accepted,
          reason: confirmation.reason, reasonSource: "user", metadata: { commandId } });
      }
      await enqueue(tx, { studioId: context.studioId, eventKey: commandId, handler: "client.created.v1" }, { clientId: created.id });
      return { id: created.id };
    }, async (tx, result) => { await lockClient(tx, result.id, context.studioId, context.userId, true, "CLIENT_CREATE"); });
  revalidatePath("/clients");
  return result;
}
export async function updateClientAction(id: string, input: ClientSchema) {
  const context = await requireStudioPermission("CLIENT_UPDATE");
  clientSchema.parse(input);
  const result = await db.transaction(async tx => {
    const before = await lockClient(tx, id, context.studioId, context.userId, false, "CLIENT_UPDATE");
    const data = parseClient(input, before);
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

// Structured review response without persisting candidates in command receipts.
export async function attemptCreateClientAction(input: ClientSchema, requestKey: string, decision?: DuplicateDecision) {
  try { return { kind: "created" as const, ...await createClientAction(input, requestKey, decision) }; }
  catch (error) {
    if (!(error instanceof DuplicateReviewRequired)) throw error;
    return { kind: "review" as const, review: await reviewClientDuplicates(input) };
  }
}
