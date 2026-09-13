"use server";
import { and, eq } from "drizzle-orm";
import { customOffers, masterPriceRevisions } from "@/db/schema";
import { requireStudioPermission } from "@/server/auth/context";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { lockClient } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";
import { resolvePrice } from "@/features/services/server/pricing";
import { recordOffer } from "./service";
import { offerSchema, overrideSchema, type OfferInput, type OverrideInput } from "../schema";
import { revalidatePath } from "next/cache";
export async function saveOffer(input: OfferInput, requestKey: string) {
  const context = await requireStudioPermission("OFFER_MANAGE"), data = offerSchema.parse(input);
  const result = await idempotentCommand(context, "OFFER_MANAGE", "offer.save.v1", requestKey, data as Json,
    (tx, commandId) => recordOffer(tx, context, data, commandId), async (tx, result) => {
      await lockClient(tx, data.clientId, context.studioId, context.userId, false, "OFFER_MANAGE");
      if (!(await tx.select().from(customOffers).where(and(eq(customOffers.id, result.offerId), eq(customOffers.studioId, context.studioId), eq(customOffers.clientId, data.clientId)))).length) throw new Error("Предложение не найдено");
    });
  revalidatePath(`/clients/${data.clientId}/offers`); return result;
}
export async function saveMasterPrice(input: OverrideInput, requestKey: string) {
  const context = await requireStudioPermission("SERVICE_UPDATE"), data = overrideSchema.parse(input);
  const result = await idempotentCommand(context, "SERVICE_UPDATE", "master-price.save.v1", requestKey, data as Json,
    async (tx, commandId) => {
      const before = await resolvePrice(tx, context.studioId, data.serviceId, data.masterId);
      if (before.overrideRevision !== data.expectedRevision) throw new Error("Цена мастера уже изменена. Обновите страницу");
      const [after] = await tx.insert(masterPriceRevisions).values({ studioId: context.studioId, serviceId: data.serviceId, masterId: data.masterId,
        revision: data.expectedRevision + 1, priceCents: data.priceCents, reason: data.reason, approvedById: context.userId }).returning();
      await writeAudit(tx, { ...context, action: "master_price_changed", entityType: "master_price_revision", entityId: after.id, before, after, reason: data.reason, reasonSource: "user", metadata: { commandId } });
      return { id: after.id, revision: after.revision };
    }, async (tx, result) => {
      if (!(await tx.select().from(masterPriceRevisions).where(and(eq(masterPriceRevisions.id, result.id), eq(masterPriceRevisions.studioId, context.studioId)))).length) throw new Error("Цена не найдена");
    });
  revalidatePath(`/services/${data.serviceId}/pricing`); return result;
}
