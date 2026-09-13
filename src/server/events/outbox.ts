import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { outboxJobs, eventInbox } from "@/db/schema";
import { payloadHash, type Json } from "@/server/commands/idempotency";
import type { Transaction } from "@/server/commands/ownership";
const envelope = z.object({ studioId: z.string().uuid(), eventKey: z.string().min(1).max(200), handler: z.string().min(1).max(100),
  effectType: z.enum(["transactional", "external"]).default("transactional"),
  availableAt: z.date().optional(), maxAttempts: z.number().int().min(1).max(20).optional() }).strict();
export async function enqueue(tx: Transaction, input: z.input<typeof envelope>, payload: Json) {
  const data = envelope.parse(input), hash = payloadHash(payload);
  const [inserted] = await tx.insert(outboxJobs).values({ ...data, payload, payloadHash: hash }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await tx.select().from(outboxJobs).where(and(eq(outboxJobs.studioId, data.studioId),
    eq(outboxJobs.handler, data.handler), eq(outboxJobs.eventKey, data.eventKey)));
  if (!existing || existing.payloadHash !== hash || existing.effectType !== data.effectType) throw new Error("Event key payload conflict");
  return existing;
}
// Only trusted/verified adapters may call this. Signature verification belongs before this transaction.
// Insertion and handler effects share a transaction; a failed handler leaves no receipt.
export async function consumeOnce<T extends Json>(tx: Transaction, studioId: string, consumer: string, eventKey: string,
  payload: Json, handle: () => Promise<T>): Promise<T> {
  z.string().uuid().parse(studioId); z.string().min(1).max(100).parse(consumer); z.string().min(1).max(200).parse(eventKey);
  const hash = payloadHash(payload);
  const [inserted] = await tx.insert(eventInbox).values({ studioId, consumer, eventKey, payloadHash: hash, result: {} }).onConflictDoNothing().returning();
  if (!inserted) {
    const [existing] = await tx.select().from(eventInbox).where(and(eq(eventInbox.studioId, studioId), eq(eventInbox.consumer, consumer), eq(eventInbox.eventKey, eventKey)));
    if (!existing || existing.payloadHash !== hash) throw new Error("Inbox payload conflict");
    return existing.result as T;
  }
  const result = await handle();
  await tx.update(eventInbox).set({ result: result === null ? sql`'null'::jsonb` : result }).where(eq(eventInbox.id, inserted.id));
  return result;
}
