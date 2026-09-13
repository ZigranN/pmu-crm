import "server-only";
import { z } from "zod";
import { and,eq,isNull,sql } from "drizzle-orm";
import { consultations,treatmentCycles,clients,masters,tasks } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { Transaction } from "@/server/commands/ownership";
import { PermanentJobError,RetryableJobError,type Job } from "@/server/events/worker";
export async function createDecisionTask(tx:Transaction,job:Job):Promise<import("@/server/commands/idempotency").Json> {
  const {consultationId}=z.object({consultationId:z.string().uuid()}).strict().parse(job.payload);
  const [record]=await tx.select().from(consultations).where(and(eq(consultations.id,consultationId),eq(consultations.studioId,job.studioId)));
  if(!record)throw new PermanentJobError();
  const clock=await tx.execute(sql`select now() as now`);const clockRows=Array.isArray(clock)?clock:(clock as unknown as {rows:{now:Date|string}[]}).rows;
  if(record.decisionDueAt>new Date((clockRows[0] as {now:Date|string}).now))throw new RetryableJobError();
  if(record.resultRecordedAt)return {consultationId,skipped:"decision_recorded"};
  const [cycle]=await tx.select().from(treatmentCycles).where(and(eq(treatmentCycles.id,record.cycleId),eq(treatmentCycles.studioId,job.studioId),isNull(treatmentCycles.archivedAt)));
  if(!cycle)return {consultationId,skipped:"archived"};
  const [client]=await tx.select().from(clients).where(and(eq(clients.id,cycle.clientId),eq(clients.studioId,job.studioId),isNull(clients.deletedAt)));
  if(!client)return {consultationId,skipped:"archived_client"};
  const [master]=await tx.select().from(masters).where(and(eq(masters.id,cycle.assignedMasterId??record.masterId),eq(masters.studioId,job.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
  if(!master?.userId||!await hasPermission(tx,master.userId,job.studioId,"MEDICAL_PROFILE_UPDATE"))throw new PermanentJobError();
  await tx.insert(tasks).values({studioId:job.studioId,clientId:cycle.clientId,appointmentId:record.appointmentId,consultationId,assignedToId:master.userId,title:"Требуется результат консультации",description:`/deals/${cycle.id}`,type:"custom",priority:"high",dueAt:record.decisionDueAt}).onConflictDoNothing();
  const [task]=await tx.select({id:tasks.id}).from(tasks).where(eq(tasks.consultationId,consultationId));
  return {consultationId,taskId:task.id};
}
