import "server-only";
import { and, or, eq, ne, sql, asc, isNull } from "drizzle-orm";
import { clients } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { resourceScope } from "@/server/auth/scopes";
import { payloadHash } from "@/server/commands/idempotency";
import { canonicalPhone, canonicalEmail, canonicalInstagram, canonicalName, similarName } from "../contacts";
import type { ClientSchema } from "../schemas/client.schema";
import { z } from "zod";
export const duplicateDecisionSchema = z.object({ token: z.string().length(64), reason: z.string().trim().min(3, "Укажите причину создания отдельной карточки").max(1000) }).strict();
export type DuplicateDecision = z.infer<typeof duplicateDecisionSchema>;
export class DuplicateReviewRequired extends Error { constructor() { super("Проверьте совпадения перед созданием клиента"); } }
export async function findDuplicates(tx: Transaction, context: { studioId: string; userId: string }, input: ClientSchema, excludeId?: string) {
  const scope = await resourceScope(context, tx);
  const keys = { phone: canonicalPhone(input.phone), whatsapp: canonicalPhone(input.whatsapp || input.phone), email: canonicalEmail(input.email), instagram: canonicalInstagram(input.instagram), name: canonicalName(`${input.firstName} ${input.lastName ?? ""}`) };
  const numbers = [...new Set([keys.phone, keys.whatsapp].filter((key): key is string => !!key))];
  const contact = or(...numbers.flatMap(key => [eq(clients.phoneKey, key), eq(clients.whatsappKey, key)]), keys.email ? eq(clients.emailKey, keys.email) : undefined, keys.instagram ? eq(clients.instagramKey, keys.instagram) : undefined) ?? sql`false`;
  const name = keys.name.length >= 3 ? or(eq(clients.nameKey, keys.name), keys.name.length >= 5 ? and(sql`left(${clients.nameKey}, 3) = ${keys.name.slice(0, 3)}`, sql`abs(length(${clients.nameKey}) - ${keys.name.length}) <= 2`) : undefined) : sql`false`;
  const rows = await tx.select({ id: clients.id, fullName: clients.fullName, phone: clients.phone, whatsapp: clients.whatsapp, email: clients.email, instagram: clients.instagram,
    phoneKey: clients.phoneKey, whatsappKey: clients.whatsappKey, emailKey: clients.emailKey, instagramKey: clients.instagramKey, nameKey: clients.nameKey, deletedAt: clients.deletedAt, updatedAt: clients.updatedAt })
    .from(clients).where(and(scope.client, scope.isMaster ? isNull(clients.deletedAt) : undefined, excludeId ? ne(clients.id, excludeId) : undefined, or(contact, name)))
    .orderBy(sql`case when ${contact} then 0 else 1 end`, asc(clients.id)).limit(201);
  const candidates = rows.slice(0, 200).flatMap(row => {
    const reasons: string[] = [];
    if (numbers.some(key => key === row.phoneKey || key === row.whatsappKey)) reasons.push("Телефон / WhatsApp");
    if (keys.email && keys.email === row.emailKey) reasons.push("Email");
    if (keys.instagram && keys.instagram === row.instagramKey) reasons.push("Instagram");
    const exact = reasons.length > 0;
    if (similarName(keys.name, row.nameKey ?? "")) reasons.push(keys.name === row.nameKey ? "Имя" : "Похожее имя");
    if (!reasons.length) return [];
    return [{ id: row.id, fullName: row.fullName, phone: row.phone, whatsapp: row.whatsapp, email: row.email, instagram: row.instagram, archived: !!row.deletedAt, level: exact ? "exact" as const : "possible" as const, reasons }];
  });
  const truncated = rows.length > 200;
  const token = payloadHash({ studioId: context.studioId, actorId: context.userId, excludeId: excludeId ?? null, keys,
    rows: JSON.parse(JSON.stringify(rows)), truncated });
  return { candidates, token, truncated };
}
export type DuplicateReview = Awaited<ReturnType<typeof findDuplicates>>;
