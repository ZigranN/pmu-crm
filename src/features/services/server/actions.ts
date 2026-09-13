"use server";
import { writeAudit } from "@/server/services/audit-log.service";
import { services } from "@/db/schema";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { withStudioCommand } from "@/server/auth/scopes";
import { entityId } from "@/server/commands/ownership";
import { revalidatePath } from "next/cache";
import { eq, and, isNull } from "drizzle-orm";
function parseService(input: ServiceSchema) {
  const { price, ...data } = serviceSchema.parse(input);
  return { ...data, priceCents: Math.round(price * 100), category: data.category as typeof services.$inferInsert.category,
    procedureType: data.procedureType as typeof services.$inferInsert.procedureType };
}
export async function createServiceAction(input: ServiceSchema) {
  const data = parseService(input);
  const result = await withStudioCommand("SERVICE_CREATE", async (tx, context) => {
    const [created] = await tx.insert(services).values({ ...data, studioId: context.studioId }).returning();
    await writeAudit(tx, { ...context, action: "service_created", entityType: "service", entityId: created.id, before: null, after: created, reason: "command:service_created" });
    return created;
  });
  revalidatePath("/services"); return result;
}
export async function updateServiceAction(id: string, input: ServiceSchema) {
  entityId.parse(id); const data = parseService(input);
  const result = await withStudioCommand("SERVICE_UPDATE", async (tx, context) => {
    const [before] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.studioId, context.studioId), isNull(services.deletedAt))).for("update");
    if (!before) throw new Error("Service not found");
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
    if (!before) throw new Error("Service not found");
    const [changed] = await tx.update(services).set({ isActive: !archived, deletedAt: archived ? new Date() : null,
      deletedById: archived ? context.userId : null, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.studioId, context.studioId))).returning();
    if (!changed) throw new Error("Service not found");
    await writeAudit(tx, { ...context, action: archived ? "service_archived" : "service_restored", entityType: "service", entityId: id, before, after: changed, reason: archived ? "command:service_archived" : "command:service_restored" });
  });
  revalidatePath("/services"); revalidatePath(`/services/${id}`);
}
export async function archiveServiceAction(id: string) { await changeArchive(id, true); }
export async function restoreServiceAction(id: string) { await changeArchive(id, false); }
