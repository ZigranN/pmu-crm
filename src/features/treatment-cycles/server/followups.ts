import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, followUpRevisions, consultationResults, followUpClosures, consultations, masters, tasks, treatmentCycles } from "@/db/schema";
import { cycleScope } from "./scope";
import { hasPermission } from "@/lib/permissions";
import type { Transaction } from "@/server/commands/ownership";
import type { Json } from "@/server/commands/idempotency";
import { PermanentJobError, RetryableJobError, type Job } from "@/server/events/worker";

// Called transactionally by the worker under its studio lock. The immutable
// result supplies the date; queued payloads cannot change a specialist's decision.
export async function createFollowUpTask(tx: Transaction, job: Job): Promise<Json> {
  const parsed = z.object({ resultId: z.string().uuid(), revisionId:z.string().uuid().optional() }).strict().safeParse(job.payload);
  if (!parsed.success) throw new PermanentJobError();
  const { resultId, revisionId } = parsed.data;
  const [source] = await tx.select({ result: consultationResults, consultation: consultations })
    .from(consultationResults).innerJoin(consultations, and(
      eq(consultations.id, consultationResults.consultationId), eq(consultations.studioId, job.studioId),
    )).where(and(eq(consultationResults.id, resultId), eq(consultationResults.studioId, job.studioId)));
  if (!source) throw new PermanentJobError();
  const { result, consultation } = source;
  const [closed]=await tx.select({id:followUpClosures.id}).from(followUpClosures).where(eq(followUpClosures.resultId,resultId));
  if(closed)return {resultId,skipped:"follow_up_closed"};
  const thinking = result.outcome === "client_thinking";
  const reassessment = result.outcome === "temporarily_unavailable";
  const [revision]=await tx.select().from(followUpRevisions).where(and(eq(followUpRevisions.resultId,resultId),eq(followUpRevisions.studioId,job.studioId))).orderBy(desc(followUpRevisions.sequence)).limit(1);
  if((revision?.id??undefined)!==revisionId)return {resultId,skipped:"schedule_superseded"};
  const dueAt = revision?.dueAt ?? (thinking ? result.followUpAt : reassessment ? result.reassessmentAt : null);
  if (!dueAt) throw new PermanentJobError();
  const [cycle] = await tx.select().from(treatmentCycles).where(and(
    eq(treatmentCycles.id, consultation.cycleId), eq(treatmentCycles.studioId, job.studioId),
  ));
  if (!cycle || cycle.archivedAt) return { resultId, skipped: "archived_cycle" };
  // A later consultation invalidates this reminder even while awaiting its result.
  const [latest] = await tx.select({ id: consultations.id }).from(consultations)
    .where(and(eq(consultations.cycleId, cycle.id), eq(consultations.studioId, job.studioId)))
    .orderBy(desc(consultations.completedAt), desc(consultations.id)).limit(1);
  if (latest?.id !== consultation.id || cycle.kind !== "pmu" ||
    (thinking ? cycle.stage !== "thinking" || cycle.suspendedAt !== null :
      cycle.stage !== "consultation_result" || !cycle.suspendedAt || cycle.suspensionReason !== "temporarily_unavailable")) {
    return { resultId, skipped: "cycle_changed" };
  }
  const [client] = await tx.select().from(clients).where(and(
    eq(clients.id, cycle.clientId), eq(clients.studioId, job.studioId), isNull(clients.deletedAt),
  ));
  if (!client) return { resultId, skipped: "archived_client" };
  const clock = await tx.execute(sql`select now() as now`);
  const rows = Array.isArray(clock) ? clock : (clock as unknown as { rows: { now: Date | string }[] }).rows;
  if (dueAt > new Date((rows[0] as { now: Date | string }).now)) throw new RetryableJobError();
  // Never route a clinical reassessment to an arbitrary admin or a stale master.
  const [master] = await tx.select().from(masters).where(and(
    eq(masters.id, cycle.assignedMasterId ?? consultation.masterId), eq(masters.studioId, job.studioId),
    eq(masters.isActive, true), isNull(masters.deletedAt),
  ));
  if (!master?.userId || !await hasPermission(tx, master.userId, job.studioId, "CLIENT_UPDATE") ||
    !await hasPermission(tx, master.userId, job.studioId, "MEDICAL_PROFILE_UPDATE") ||
    !await hasPermission(tx, master.userId, job.studioId, "MEDICAL_PROFILE_READ") ||
    !await hasPermission(tx, master.userId, job.studioId, "CLIENT_READ")) throw new PermanentJobError();
  const [accessible] = await tx.select({id:treatmentCycles.id}).from(treatmentCycles).where(and(
    eq(treatmentCycles.id,cycle.id),await cycleScope({studioId:job.studioId,userId:master.userId},tx),
  ));
  if(!accessible) throw new PermanentJobError();
  await tx.insert(tasks).values({
    studioId: job.studioId, clientId: cycle.clientId, appointmentId: consultation.appointmentId,
    followUpResultId: resultId, followUpRevisionId:revisionId??null, assignedToId: master.userId,
    title: thinking ? "Повторный контакт с клиентом" : "Повторная оценка специалистом",
    description: `/deals/${cycle.id}`, type: "custom", priority: "normal", dueAt,
  }).onConflictDoNothing();
  const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.followUpResultId, resultId),revisionId?eq(tasks.followUpRevisionId,revisionId):isNull(tasks.followUpRevisionId)));
  return { resultId, taskId: task.id };
}
