import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { services, serviceDefinitions, whatsappTemplates } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { writeAudit } from "@/server/services/audit-log.service";
import { getStudioRole } from "@/lib/roles";
export async function serviceValues(tx: Transaction, studioId: string, input: ServiceSchema) {
  const data = serviceSchema.parse(input);
  const [definition] = await tx.select().from(serviceDefinitions).where(eq(serviceDefinitions.code, data.catalogCode));
  if (!definition) throw new Error("Выберите услугу из справочника");
  if (definition.durationMinutes !== null && data.durationMinutes !== definition.durationMinutes) throw new Error(`Длительность по ТЗ: ${definition.durationMinutes} минут`);
  for (const [id, category] of [[data.preparationTemplateId, "preparation"], [data.postCareTemplateId, "post_care"]] as const) {
    if (id && !(await tx.select({ id: whatsappTemplates.id }).from(whatsappTemplates).where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.studioId, studioId),
      eq(whatsappTemplates.category, category), eq(whatsappTemplates.isActive, true), isNull(whatsappTemplates.deletedAt)))).length) throw new Error("Шаблон недоступен или имеет другое назначение");
  }
  return { name: definition.name, description: data.description ?? "", catalogVersion: 1, catalogCode: definition.code,
    category: definition.category, procedureType: definition.procedureType, sessionsModel: definition.sessionsModel,
    priceMode: data.priceMode, priceCents: data.price === null ? null : Math.round(data.price * 100),
    priceMaxCents: data.priceMax === null ? null : Math.round(data.priceMax * 100), durationMinutes: data.durationMinutes,
    preparationTemplateId: data.preparationTemplateId, postCareTemplateId: data.postCareTemplateId,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, requiresCorrection: definition.sessionsModel === "two", correctionAfterDays: null,
    isActive: data.isActive };
}
// The caller holds the same studio lock used by service mutations/seed.
export async function initializeCatalog(tx: Transaction, studioId: string, userId: string) {
  if (await getStudioRole(tx, userId, studioId) !== "OWNER") throw new Error("Permission denied");
  const definitions = await tx.select().from(serviceDefinitions);
  const existing = await tx.select({ code: services.catalogCode }).from(services).where(eq(services.studioId, studioId));
  const codes = new Set(existing.map(row => row.code)); let created = 0;
  for (const definition of definitions) {
    if (codes.has(definition.code)) continue; // Preserve edited/archived catalog entries on repeat.
    const data = serviceSchema.parse({ catalogCode: definition.code, priceMode: definition.priceMode,
      price: definition.priceCents === null ? null : definition.priceCents / 100,
      priceMax: definition.priceMaxCents === null ? null : definition.priceMaxCents / 100,
      durationMinutes: definition.durationMinutes, preparationTemplateId: null, postCareTemplateId: null,
      isActive: definition.durationMinutes !== null });
    const values = await serviceValues(tx, studioId, data);
    const [service] = await tx.insert(services).values({ ...values, studioId }).returning();
    await writeAudit(tx, { studioId, userId, action: "service_created", entityType: "service", entityId: service.id,
      before: null, after: service, reason: "command:initialize_phase3_catalog" });
    created++;
  }
  return { created, existing: codes.size - (codes.has(null) ? 1 : 0) };
}
export async function assertCatalogAvailable(tx: Transaction, studioId: string, code: string, ownId?: string) {
  const entries = await tx.select({ id: services.id }).from(services).where(and(eq(services.studioId, studioId), eq(services.catalogCode, code)));
  if (entries.some(row => row.id !== ownId)) throw new Error("Такая услуга уже есть в каталоге, включая архив. Отредактируйте существующую запись");
}
