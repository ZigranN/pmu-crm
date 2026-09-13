import { z } from "zod";
export const cents = z.number().int().min(0).max(2147483647);
export const reason = z.string().trim().min(3, "Укажите причину (минимум 3 символа)").max(1000);
export const overrideSchema = z.object({ serviceId: z.string().uuid(), masterId: z.string().uuid(), priceCents: cents.nullable(), expectedRevision: z.number().int().min(0), reason }).strict();
export const offerSchema = z.object({
  offerId: z.string().uuid().nullable(), clientId: z.string().uuid(), expectedRevision: z.number().int().min(0),
  agreedTotalCents: cents, reason,
  items: z.array(z.object({ serviceId: z.string().uuid(), masterId: z.string().uuid().nullable(),
    standardCents: cents.nullable(), priceVersion: z.string().length(64) }).strict()).min(2).max(3),
}).strict();
export type OfferInput = z.infer<typeof offerSchema>;
export type OverrideInput = z.infer<typeof overrideSchema>;
