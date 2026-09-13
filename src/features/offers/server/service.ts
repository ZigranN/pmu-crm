import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { customOffers, offerRevisions, offerItems } from "@/db/schema";
import { lockClient, type Transaction } from "@/server/commands/ownership";
import { resolvePrice } from "@/features/services/server/pricing";
import { cents, type OfferInput } from "../schema";
import { writeAudit } from "@/server/services/audit-log.service";
export async function recordOffer(tx: Transaction, context: { studioId: string; userId: string }, data: OfferInput, commandId: string) {
  await lockClient(tx, data.clientId, context.studioId, context.userId, false, "OFFER_MANAGE");
  const offer = data.offerId ? (await tx.select().from(customOffers).where(and(eq(customOffers.id, data.offerId), eq(customOffers.studioId, context.studioId), eq(customOffers.clientId, data.clientId))))[0] : undefined;
  if (data.offerId && !offer) throw new Error("Предложение не найдено");
  const previous = offer ? (await tx.select().from(offerRevisions).where(eq(offerRevisions.offerId, offer.id)).orderBy(desc(offerRevisions.revision)).limit(1))[0] : undefined;
  if (data.expectedRevision !== (previous?.revision ?? 0)) throw new Error("Предложение уже изменено. Обновите страницу");
  const items = [];
  for (const input of data.items) {
    const price = await resolvePrice(tx, context.studioId, input.serviceId, input.masterId);
    if (price.categoryCode !== "pmu" || !["brows", "eyes", "lips"].includes(price.zoneCode)) throw new Error("Custom Offer предназначен для нескольких зон PMU");
    if (price.version !== input.priceVersion) throw new Error("Цена изменилась. Обновите расчёт");
    if (price.mode === "fixed" && input.standardCents !== null) throw new Error("Фиксированная цена рассчитывается сервером");
    if (price.mode !== "fixed" && input.standardCents === null) throw new Error("Для ориентира или цены мастера укажите подтверждённую стандартную цену");
    const standardCents = cents.parse(price.mode === "fixed" ? price.priceCents : input.standardCents);
    items.push({ studioId: context.studioId, serviceId: input.serviceId, masterId: input.masterId, zoneCode: price.zoneCode,
      serviceName: price.serviceName, masterName: price.masterName, standardCents,
      priceSnapshot: { source: price.source, mode: price.mode, priceCents: price.priceCents, priceMaxCents: price.priceMaxCents, version: price.version, humanQuoted: price.mode !== "fixed" } });
  }
  if (new Set(items.map(item => item.zoneCode)).size !== items.length) throw new Error("Выберите разные зоны");
  const standardTotalCents = cents.parse(items.reduce((total, item) => total + item.standardCents, 0));
  const header = offer ?? (await tx.insert(customOffers).values({ studioId: context.studioId, clientId: data.clientId }).returning())[0];
  const [revision] = await tx.insert(offerRevisions).values({ studioId: context.studioId, offerId: header.id, revision: data.expectedRevision + 1,
    standardTotalCents, agreedTotalCents: data.agreedTotalCents, discountCents: Math.max(0, standardTotalCents - data.agreedTotalCents),
    reason: data.reason, approvedById: context.userId }).returning();
  const savedItems = await tx.insert(offerItems).values(items.map(item => ({ ...item, revisionId: revision.id }))).returning();
  const previousItems = previous ? await tx.select().from(offerItems).where(eq(offerItems.revisionId, previous.id)) : [];
  await writeAudit(tx, { ...context, action: previous ? "offer_revised" : "offer_created", entityType: "offer_revision", entityId: revision.id,
    before: previous ? { ...previous, items: previousItems } : null, after: { ...revision, items: savedItems }, reason: data.reason, reasonSource: "user", metadata: { commandId, clientId: data.clientId, offerId: header.id } });
  return { offerId: header.id, revisionId: revision.id, revision: revision.revision };
}
