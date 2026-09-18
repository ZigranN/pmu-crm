"use server";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { cycleCommercialTerms } from "@/db/schema";
import { requireStudioPermission } from "@/server/auth/context";
import { idempotentCommand } from "@/server/commands/idempotency";
import { writeAudit } from "@/server/services/audit-log.service";
import { lockCycle } from "@/features/treatment-cycles/server/scope";
import { termsSchema, type TermsInput } from "../contract";
import { latestTerms, termsBlocker, termsSource } from "./service";

export async function confirmTermsAction(input: TermsInput, requestKey: string) {
  const data = termsSchema.parse(input), context = await requireStudioPermission("OFFER_MANAGE");
  const result = await idempotentCommand(context, "OFFER_MANAGE", "cycle.terms-confirm.v1", requestKey, data, async (tx, commandId) => {
    const cycle = await lockCycle(tx, context, data.cycleId), before = await latestTerms(tx, cycle.id);
    if (cycle.version !== data.expectedCycleVersion || (before?.revision ?? 0) !== data.expectedRevision) throw new Error("Цикл или условия изменены. Обновите данные");
    const blocked = await termsBlocker(tx, cycle); if (blocked) throw new Error(blocked);
    const clock = await tx.execute(sql`select now() as now`);
    const rows = Array.isArray(clock) ? clock : (clock as unknown as {rows: {now: string | Date}[]}).rows;
    const confirmedAt = new Date((rows[0] as {now: string | Date}).now), reviewAt = new Date(data.reviewAt);
    if (reviewAt <= confirmedAt) throw new Error("Дата пересмотра должна быть в будущем");
    const source = await termsSource(tx, cycle, data);
    const [after] = await tx.insert(cycleCommercialTerms).values({ ...source, studioId: context.studioId, cycleId: cycle.id,
      cycleVersion: cycle.version, revision: data.expectedRevision + 1, commandId, actorId: context.userId,
      source: data.source, reason: data.reason, confirmedAt, reviewAt }).returning();
    await writeAudit(tx, {...context, action: "commercial_terms_confirmed", entityType: "cycle_commercial_terms", entityId: after.id,
      before, after, reason: data.reason, reasonSource: "user", metadata: {commandId, cycleId: cycle.id}});
    return {id: after.id, cycleId: cycle.id, revision: after.revision};
  }, async (tx, result) => { await lockCycle(tx, context, result.cycleId); });
  revalidatePath(`/deals/${result.cycleId}`); return result;
}
