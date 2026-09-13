import "server-only";
import { canonicalClientId } from "@/features/clients/server/identity";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customOffers, offerRevisions, offerItems, services, masterServices, masters, user, studios } from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";
import { lockClient, entityId, type Transaction } from "@/server/commands/ownership";
import { lockStudioAccess } from "@/server/auth/scopes";
import { hasPermission } from "@/lib/permissions";
import { resolvePrice } from "@/features/services/server/pricing";
async function pricingOptions(tx: Transaction, studioId: string, serviceId?: string) {
  const rows = await tx.select({ id: services.id }).from(services).where(and(eq(services.studioId, studioId), eq(services.catalogVersion, 1), eq(services.isActive, true), isNull(services.deletedAt), serviceId ? eq(services.id, serviceId) : undefined));
  const result = [];
  for (const row of rows) {
    const base = await resolvePrice(tx, studioId, row.id, null);
    if (!serviceId && base.categoryCode !== "pmu") continue;
    const links = await tx.select().from(masterServices).where(and(eq(masterServices.studioId, studioId), eq(masterServices.serviceId, row.id)));
    result.push(base);
    for (const link of links) {
      // Filter active masters explicitly; invalid links must not hide database failures.
      if (!(await tx.select({ id: masters.id }).from(masters).where(and(eq(masters.id, link.masterId), eq(masters.studioId, studioId), eq(masters.isActive, true), isNull(masters.deletedAt)))).length) continue;
      result.push(await resolvePrice(tx, studioId, row.id, link.masterId));
    }
  }
  return result;
}
export async function getOfferWorkspace(clientId: string) {
  entityId.parse(clientId);
  return sensitiveRead("OFFER_READ", undefined, { operation: "offers.read", targetId: clientId }, context => db.transaction(async tx => {
    clientId = await canonicalClientId(clientId, context.studioId, tx);
    await lockClient(tx, clientId, context.studioId, context.userId, false, "OFFER_READ");
    const [studio] = await tx.select({ timezone: studios.timezone }).from(studios).where(eq(studios.id, context.studioId));
    const offers = await tx.select().from(customOffers).where(and(eq(customOffers.clientId, clientId), eq(customOffers.studioId, context.studioId)));
    const revisions = offers.length ? await tx.select().from(offerRevisions).where(inArray(offerRevisions.offerId, offers.map(row => row.id))).orderBy(desc(offerRevisions.createdAt), desc(offerRevisions.revision)) : [];
    const items = revisions.length ? await tx.select().from(offerItems).where(inArray(offerItems.revisionId, revisions.map(row => row.id))) : [];
    const approvers = revisions.length ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(revisions.map(row => row.approvedById))])) : [];
    const canManage = await hasPermission(tx, context.userId, context.studioId, "OFFER_MANAGE");
    return { timezone: studio.timezone, offers, revisions: revisions.map(revision => ({ ...revision, approverName: approvers.find(person => person.id === revision.approvedById)?.name ?? "Пользователь удалён", items: items.filter(item => item.revisionId === revision.id) })), options: canManage ? await pricingOptions(tx, context.studioId) : [], canManage };
  }), result => result.revisions.map(row => row.id));
}
export async function getServicePricing(serviceId: string) {
  entityId.parse(serviceId);
  return sensitiveRead("SERVICE_UPDATE", undefined, { operation: "pricing.read", targetId: serviceId }, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, "SERVICE_UPDATE")) throw new Error("Permission denied");
    return pricingOptions(tx, context.studioId, serviceId);
  }), rows => [...new Set(rows.map(row => row.serviceId))]);
}
export type PriceOption = Awaited<ReturnType<typeof resolvePrice>>;
export type OfferWorkspace = Awaited<ReturnType<typeof getOfferWorkspace>>;
