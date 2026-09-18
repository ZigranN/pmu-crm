import "server-only";
import { getStudioRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { and, desc, eq, sql } from "drizzle-orm";
import { cycleCommercialTerms, customOffers, offerItems, offerRevisions, treatmentCycles } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { resolvePrice } from "@/features/services/server/pricing";
import type { TermsInput } from "../contract";

export async function canConfirmTerms(tx: Transaction, context: {studioId: string; userId: string}) {
  const role = await getStudioRole(tx, context.userId, context.studioId);
  return (role === "OWNER" || role === "ADMIN") && await hasPermission(tx, context.userId, context.studioId, "OFFER_MANAGE");
}

export async function latestTerms(tx: Transaction, cycleId: string) {
  return (await tx.select().from(cycleCommercialTerms).where(eq(cycleCommercialTerms.cycleId, cycleId)).orderBy(desc(cycleCommercialTerms.revision)).limit(1))[0] ?? null;
}
export async function termsBlocker(tx: Transaction, cycle: typeof treatmentCycles.$inferSelect) {
  if (cycle.kind !== "pmu" || cycle.packageId || cycle.suspendedAt || cycle.firstSessionAt || cycle.secondSessionAt || cycle.completedAt ||
    !["new_lead", "qualification", "consultation_needed", "consultation_offered", "consultation_booked", "consultation_confirmed", "consultation_result", "thinking"].includes(cycle.stage))
    return "Условия доступны только до процедуры, вне приостановленного цикла и Total Face";
  const result = await tx.execute(sql`select 1 from appointment_cycles l join appointments a on a.id=l.appointment_id where l.cycle_id=${cycle.id} and (l.visit_kind<>'consultation' or exists(select 1 from payments p where p.appointment_id=a.id) or exists(select 1 from payment_transactions p where p.appointment_id=a.id))
    union all select 1 from procedure_sessions p where p.cycle_id=${cycle.id} limit 1`);
  const rows = Array.isArray(result) ? result : (result as unknown as {rows: unknown[]}).rows;
  return rows.length ? "Связанные процедуры или оплаты требуют отдельного финансового решения" : null;
}
export async function termsSource(tx: Transaction, cycle: typeof treatmentCycles.$inferSelect, data: TermsInput): Promise<Pick<typeof cycleCommercialTerms.$inferInsert, "serviceId" | "masterId" | "offerItemId" | "amountCents" | "sourceSnapshot">> {
  if (data.source === "catalog") {
    const price = await resolvePrice(tx, cycle.studioId, data.serviceId, cycle.assignedMasterId);
    if (price.categoryCode !== "pmu" || price.zoneCode !== cycle.zoneCode || (cycle.serviceId && cycle.serviceId !== price.serviceId)) throw new Error("Услуга не соответствует зоне или услуге цикла");
    if (price.version !== data.priceVersion) throw new Error("Цена изменилась. Обновите данные и подтвердите условия заново");
    const fixed = price.mode === "fixed";
    if (fixed && data.quotedCents !== null) throw new Error("Фиксированная цена определяется сервером");
    const amountCents = fixed ? price.priceCents : data.quotedCents;
    if (amountCents === null) throw new Error("Укажите подтверждённую человеком цену");
    return { serviceId: price.serviceId, masterId: price.masterId, offerItemId: null, amountCents,
      sourceSnapshot: { ...price, humanQuoted: !fixed } };
  }
  const [row] = await tx.select({item: offerItems, revision: offerRevisions, offer: customOffers}).from(offerItems)
    .innerJoin(offerRevisions, eq(offerRevisions.id, offerItems.revisionId)).innerJoin(customOffers, eq(customOffers.id, offerRevisions.offerId))
    .where(and(eq(offerItems.id, data.offerItemId), eq(offerItems.studioId, cycle.studioId), eq(customOffers.clientId, cycle.clientId)));
  if (!row || row.item.zoneCode !== cycle.zoneCode || row.item.masterId !== cycle.assignedMasterId || (cycle.serviceId && cycle.serviceId !== row.item.serviceId)) throw new Error("Предложение не соответствует клиенту, зоне или мастеру цикла");
  const [latest] = await tx.select().from(offerRevisions).where(eq(offerRevisions.offerId, row.offer.id)).orderBy(desc(offerRevisions.revision)).limit(1);
  if (latest.id !== row.revision.id) throw new Error("Предложение изменено. Выберите последнюю редакцию");
  const live = await resolvePrice(tx, cycle.studioId, row.item.serviceId, row.item.masterId);
  if (live.version !== row.item.priceSnapshot.version) throw new Error("Цена изменилась. Сначала подтвердите новую редакцию Custom Offer");
  // The bundle total is a labelled reference. It is NEVER a per-cycle charge/allocation.
  return {serviceId: row.item.serviceId, masterId: row.item.masterId, offerItemId: row.item.id, amountCents: null,
    sourceSnapshot: {offerId: row.offer.id, offerRevisionId: row.revision.id, offerRevision: row.revision.revision,
      serviceName: row.item.serviceName, zoneCode: row.item.zoneCode, standardCents: row.item.standardCents,
      offerTotalCents: row.revision.agreedTotalCents, priceVersion: live.version}};
}
