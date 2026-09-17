import "server-only";
import { and, eq, desc, isNull } from "drizzle-orm";
import { services, serviceDefinitions, masters, masterServices, masterPriceRevisions } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { payloadHash } from "@/server/commands/idempotency";
// Internal domain service. Callers authorize and hold the studio lock.
export async function resolvePrice(tx: Transaction, studioId: string, serviceId: string, masterId: string | null) {
  const [row] = await tx.select({ service: services, definition: serviceDefinitions }).from(services)
    .innerJoin(serviceDefinitions, eq(services.catalogCode, serviceDefinitions.code))
    .where(and(eq(services.id, serviceId), eq(services.studioId, studioId), eq(services.catalogVersion, 1), eq(services.isActive, true), isNull(services.deletedAt)));
  if (!row) throw new Error("Услуга недоступна");
  let masterName: string | null = null;
  if (masterId) {
    const [master] = await tx.select({ name: masters.displayName }).from(masters).innerJoin(masterServices, and(eq(masterServices.masterId, masters.id), eq(masterServices.serviceId, serviceId), eq(masterServices.studioId, studioId)))
      .where(and(eq(masters.id, masterId), eq(masters.studioId, studioId), eq(masters.isActive, true), isNull(masters.deletedAt)));
    if (!master) throw new Error("Мастер недоступен для этой услуги");
    masterName = master.name;
  }
  const override = masterId ? (await tx.select().from(masterPriceRevisions).where(and(eq(masterPriceRevisions.studioId, studioId), eq(masterPriceRevisions.serviceId, serviceId), eq(masterPriceRevisions.masterId, masterId))).orderBy(desc(masterPriceRevisions.revision)).limit(1))[0] : undefined;
  const overridden = override?.priceCents != null;
  const snapshot = { source: overridden ? "master_override" : "service_base", mode: overridden ? "fixed" : row.service.priceMode,
    priceCents: overridden ? override.priceCents : row.service.priceCents, priceMaxCents: overridden ? null : row.service.priceMaxCents };
  const version = payloadHash({ ...snapshot, serviceId, masterId, overrideId: override?.id ?? null });
  return { ...snapshot, version, overrideRevision: override?.revision ?? 0, overridePriceCents: override?.priceCents ?? null,
    serviceId, masterId, serviceName: row.service.name, masterName, zoneCode: row.definition.zoneCode, categoryCode: row.definition.categoryCode };
}
