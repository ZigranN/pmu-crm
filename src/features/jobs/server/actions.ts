"use server";
import { db } from "@/db";
import { outboxJobs } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireStudioContext } from "@/server/auth/context";
import { lockStudioAccess } from "@/server/auth/scopes";
import { writeAudit } from "@/server/services/audit-log.service";
import { handlers } from "@/server/events/registry";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export async function recoverJob(input: { id: string; reason: string }) {
  const data = z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).strict().parse(input);
  const context = await requireStudioContext();
  await db.transaction(async tx => {
    const actor = await lockStudioAccess(tx, context);
    if (actor.role !== "OWNER") throw new Error("Permission denied");
    const [job] = await tx.select().from(outboxJobs).where(and(eq(outboxJobs.id, data.id), eq(outboxJobs.studioId, context.studioId))).for("update");
    if (!job || !["dead", "uncertain"].includes(job.state)) throw new Error("Задача уже обработана или не требует восстановления");
    if (!Object.hasOwn(handlers, job.handler)) throw new Error("Обработчик недоступен; сначала требуется исправление конфигурации");
    if (handlers[job.handler].kind !== job.effectType) throw new Error("Тип обработчика не совпадает с сохранённой задачей");
    // An uncertain send may only be reconciled, never reset to pending by a human retry.
    const state = job.state === "uncertain" ? "uncertain" : "pending";
    if (state === "uncertain" && handlers[job.handler].kind !== "external") throw new Error("Требуется проверка внешней отправки");
    await tx.update(outboxJobs).set({ state, attempts: 0, availableAt: sql`now()`, lastError: null, updatedAt: sql`now()` }).where(eq(outboxJobs.id, job.id));
    await writeAudit(tx, { ...context, action: "job_recovered", entityType: "outbox_job", entityId: job.id,
      before: { state: job.state, attempts: job.attempts }, after: { state, attempts: 0 }, reason: data.reason, reasonSource: "user" });
  });
  revalidatePath("/settings/jobs");
}
