import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycleCommercialTerms, services, serviceDefinitions, masterServices, customOffers, offerRevisions, offerItems, user, studios, masters } from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";
import { lockStudioAccess } from "@/server/auth/scopes";
import { lockCycle } from "@/features/treatment-cycles/server/scope";
import { hasPermission } from "@/lib/permissions";
import { resolvePrice } from "@/features/services/server/pricing";
import { termsBlocker, canConfirmTerms } from "./service";
import { termsNeedReview } from "../contract";

export async function getCommercialTerms(id: string) {
  z.string().uuid().parse(id);
  // A scoped master may read the confirmed financial terms, never the offer workspace or write command.
  return sensitiveRead("PAYMENT_READ", undefined, {operation: "commercial-terms.read", targetId: id}, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, "PAYMENT_READ")) throw new Error("Permission denied");
    const cycle = await lockCycle(tx, context, id);
    const rows = await tx.select({terms: cycleCommercialTerms, actorName: user.name}).from(cycleCommercialTerms).leftJoin(user, eq(user.id, cycleCommercialTerms.actorId))
      .where(eq(cycleCommercialTerms.cycleId, id)).orderBy(desc(cycleCommercialTerms.revision)).limit(50);
    const history = rows.map(row => ({...row.terms, actorName: row.actorName ?? row.terms.actorId}));
    let blocked = await termsBlocker(tx, cycle);
    if (cycle.assignedMasterId && !(await tx.select({id: masters.id}).from(masters).where(and(eq(masters.id, cycle.assignedMasterId), eq(masters.studioId, context.studioId), eq(masters.isActive, true), isNull(masters.deletedAt)))).length) blocked = "Назначенный мастер недоступен";
    const [studio] = await tx.select({timezone: studios.timezone}).from(studios).where(eq(studios.id, context.studioId));
    const canManage = await canConfirmTerms(tx, context);
    const options: Awaited<ReturnType<typeof resolvePrice>>[] = [];
    const offers: {id: string; label: string}[] = [];
    if (canManage && !blocked) {
      const candidates = await tx.select({id: services.id}).from(services).innerJoin(serviceDefinitions, eq(serviceDefinitions.code, services.catalogCode))
        .where(and(eq(services.studioId, context.studioId), eq(services.catalogVersion, 1), eq(services.isActive, true), isNull(services.deletedAt),
          eq(serviceDefinitions.categoryCode, "pmu"), eq(serviceDefinitions.zoneCode, cycle.zoneCode), cycle.serviceId ? eq(services.id, cycle.serviceId) : undefined));
      for (const candidate of candidates) {
        if (cycle.assignedMasterId && !(await tx.select().from(masterServices).where(and(eq(masterServices.masterId, cycle.assignedMasterId), eq(masterServices.serviceId, candidate.id), eq(masterServices.studioId, context.studioId)))).length) continue;
        options.push(await resolvePrice(tx, context.studioId, candidate.id, cycle.assignedMasterId));
      }
      const headers = await tx.select().from(customOffers).where(and(eq(customOffers.studioId, context.studioId), eq(customOffers.clientId, cycle.clientId)));
      for (const header of headers) {
        const [revision] = await tx.select().from(offerRevisions).where(eq(offerRevisions.offerId, header.id)).orderBy(desc(offerRevisions.revision)).limit(1);
        if (!revision) continue;
        const items = await tx.select().from(offerItems).where(and(eq(offerItems.revisionId, revision.id), eq(offerItems.zoneCode, cycle.zoneCode)));
        for (const item of items) if (item.masterId === cycle.assignedMasterId && options.some(p => p.serviceId === item.serviceId && p.version === item.priceSnapshot.version))
          offers.push({id: item.id, label: `${item.serviceName} · Custom Offer #${revision.revision} · общий итог ${(revision.agreedTotalCents / 100).toFixed(2)} EUR`});
      }
    }
    return {timezone: studio.timezone, cycleId: id, cycleVersion: cycle.version, history, options, offers, canManage, blocked,
      needsReview: history[0] ? termsNeedReview(history[0].reviewAt, new Date()) : false};
  }), data => data.history.map(row => row.id));
}
export type CommercialTermsPanel = Awaited<ReturnType<typeof getCommercialTerms>>;
