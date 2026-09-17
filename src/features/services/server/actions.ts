"use server";
import { writeAudit } from "@/server/services/audit-log.service";
import { services, masterServices, masters } from "@/db/schema";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { withStudioCommand } from "@/server/auth/scopes";
import { entityId } from "@/server/commands/ownership";
import { revalidatePath } from "next/cache";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { serviceValues, initializeCatalog, assertCatalogAvailable } from "./catalog-service";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { requireStudioPermission } from "@/server/auth/context";
import { getStudioRole } from "@/lib/roles";
import { z } from "zod";
export async function createServiceAction(input: ServiceSchema, requestKey: string) {
  const context = await requireStudioPermission("SERVICE_CREATE");
  const inputData = serviceSchema.parse(input);
  const result = await idempotentCommand(context, "SERVICE_CREATE", "service.create.v1", requestKey, JSON.parse(JSON.stringify(inputData)) as Json,
    async (tx, commandId) => {
      const data = await serviceValues(tx, context.studioId, inputData);
      await assertCatalogAvailable(tx, context.studioId, data.catalogCode);
      const [created] = await tx.insert(services).values({ ...data, studioId: context.studioId }).returning();
      await writeAudit(tx, { ...context, action: "service_created", entityType: "service", entityId: created.id, before: null, after: created, reason: "command:service_created", metadata: { commandId } });
      return { id: created.id };
    }, async (tx, result) => {
      if (!(await tx.select({ id: services.id }).from(services).where(and(eq(services.id, result.id), eq(services.studioId, context.studioId)))).length) throw new Error("Service not found");
    });
  revalidatePath("/services"); return result;
}
export async function updateServiceAction(id: string, input: ServiceSchema) {
  entityId.parse(id);
  const result = await withStudioCommand("SERVICE_UPDATE", async (tx, context) => {
    const [before] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.studioId, context.studioId), isNull(services.deletedAt))).for("update");
    if (!before || before.supersededById) throw new Error("Service not found");
    const data = await serviceValues(tx, context.studioId, input);
    if (before.catalogCode && before.catalogCode !== data.catalogCode) throw new Error("Нельзя менять вид существующей услуги; создайте отдельную запись");
    await assertCatalogAvailable(tx, context.studioId, data.catalogCode, id);
    const [after] = await tx.update(services).set({ ...data, updatedAt: new Date() }).where(eq(services.id, before.id)).returning();
    await writeAudit(tx, { ...context, action: "service_updated", entityType: "service", entityId: id, before, after, reason: "command:service_updated" });
    return after;
  });
  revalidatePath("/services"); revalidatePath(`/services/${id}`); return result;
}
async function changeArchive(id: string, archived: boolean) {
  entityId.parse(id);
  await withStudioCommand(archived ? "SERVICE_ARCHIVE" : "SERVICE_UPDATE", async (tx, context) => {
    const [before] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.studioId, context.studioId))).for("update");
    if (!before || before.supersededById) throw new Error("Service not found");
    const [changed] = await tx.update(services).set({ isActive: !archived && (before.catalogVersion === 0 || before.durationMinutes !== null), deletedAt: archived ? new Date() : null,
      deletedById: archived ? context.userId : null, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.studioId, context.studioId))).returning();
    if (!changed) throw new Error("Service not found");
    await writeAudit(tx, { ...context, action: archived ? "service_archived" : "service_restored", entityType: "service", entityId: id, before, after: changed, reason: archived ? "command:service_archived" : "command:service_restored" });
  });
  revalidatePath("/services"); revalidatePath(`/services/${id}`);
}
export async function archiveServiceAction(id: string) { await changeArchive(id, true); }
export async function restoreServiceAction(id: string) { await changeArchive(id, false); }

export async function importPhase3Catalog() {
  const result = await withStudioCommand("SERVICE_CREATE", (tx, context) => initializeCatalog(tx, context.studioId, context.userId));
  revalidatePath("/services"); return result;
}
export async function consolidateServices(input: { canonicalId: string; duplicateIds: string[]; reason: string }) {
  const data = z.object({ canonicalId: z.string().uuid(), duplicateIds: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().min(3).max(1000) }).strict().parse(input);
  if (data.duplicateIds.includes(data.canonicalId)) throw new Error("Услуга не может заменить сама себя");
  await withStudioCommand("SERVICE_ARCHIVE", async (tx, context) => {
    if (await getStudioRole(tx, context.userId, context.studioId) !== "OWNER") throw new Error("Permission denied");
    const [canonical] = await tx.select().from(services).where(and(eq(services.id, data.canonicalId), eq(services.studioId, context.studioId))).for("update");
    if (!canonical || canonical.catalogVersion !== 1 || canonical.supersededById || canonical.deletedAt) throw new Error("Выберите действующую запись каталога");
    for (const id of [...new Set(data.duplicateIds)].sort()) {
      const [before] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.studioId, context.studioId))).for("update");
      if (!before) throw new Error("Service not found");
      if (before.supersededById === canonical.id) continue;
      if (before.catalogVersion !== 0 || before.supersededById) throw new Error("Можно объединять только непроверенные старые записи");
      const links = await tx.select().from(masterServices).where(and(eq(masterServices.serviceId, id), eq(masterServices.studioId, context.studioId)));
      if (links.length) {
        const validMasters = await tx.select({ id: masters.id }).from(masters).where(and(eq(masters.studioId, context.studioId), inArray(masters.id, links.map(link => link.masterId))));
        if (validMasters.length !== new Set(links.map(link => link.masterId)).size) throw new Error("Связь мастера относится к другой студии");
      }
      if (links.length) await tx.insert(masterServices).values(links.map(link => ({ studioId: context.studioId, masterId: link.masterId, serviceId: canonical.id }))).onConflictDoNothing();
      // Original links/appointments/snapshots are retained as historical evidence.
      const [after] = await tx.update(services).set({ supersededById: canonical.id, isActive: false, deletedAt: new Date(), deletedById: context.userId, updatedAt: new Date() }).where(eq(services.id, id)).returning();
      await writeAudit(tx, { ...context, action: "service_consolidated", entityType: "service", entityId: id, before, after, reason: data.reason, reasonSource: "user", metadata: { canonicalId: canonical.id } });
    }
  });
  revalidatePath("/services"); revalidatePath(`/services/${data.canonicalId}/edit`);
}
