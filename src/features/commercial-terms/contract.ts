import { z } from "zod";
const common = {
  cycleId: z.string().uuid(), expectedCycleVersion: z.number().int().positive(),
  expectedRevision: z.number().int().nonnegative(), reviewAt: z.string().datetime({offset: true}),
  reason: z.string().trim().min(3).max(1000),
};
export const termsSchema = z.discriminatedUnion("source", [
  z.object({...common, source: z.literal("catalog"), serviceId: z.string().uuid(), priceVersion: z.string().length(64),
    quotedCents: z.number().int().min(0).max(2147483647).nullable()}).strict(),
  z.object({...common, source: z.literal("offer"), offerItemId: z.string().uuid()}).strict(),
]);
export type TermsInput = z.infer<typeof termsSchema>;
// Equality is already due. Expiry is a review signal, never a price mutation.
export function termsNeedReview(reviewAt: Date | string, now: Date) {
  return new Date(reviewAt).getTime() <= now.getTime();
}
