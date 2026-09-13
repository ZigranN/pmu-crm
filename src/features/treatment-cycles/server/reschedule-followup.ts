"use server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { consultations, consultationResults, followUpClosures, followUpRevisions, tasks } from "@/db/schema";
import { rescheduleFollowUpSchema } from "@/features/consultations/contracts";
import { requireStudioPermission } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { idempotentCommand } from "@/server/commands/idempotency";
import { enqueue } from "@/server/events/outbox";
import { lockCycle } from "./scope";
import { recordCycleChange } from "./mutation";

export async function rescheduleFollowUpAction(input:z.infer<typeof rescheduleFollowUpSchema>,key:string) {
  const data=rescheduleFollowUpSchema.parse(input),context=await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const response=await idempotentCommand(context,"MEDICAL_PROFILE_UPDATE","cycle.follow-up-reschedule.v1",key,data,async(tx,commandId)=>{
    if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");
    const cycle=await lockCycle(tx,context,data.id);
    if(cycle.version!==data.expectedVersion)throw new Error("Цикл изменён. Обновите данные");
    const [latest]=await tx.select().from(consultations).where(and(eq(consultations.cycleId,cycle.id),eq(consultations.studioId,context.studioId))).orderBy(desc(consultations.completedAt),desc(consultations.id)).limit(1);
    const [result]=await tx.select().from(consultationResults).where(and(eq(consultationResults.id,data.resultId),eq(consultationResults.studioId,context.studioId)));
    if(!result||result.consultationId!==latest?.id||cycle.kind!=="pmu"||!(
      (result.outcome==="client_thinking"&&cycle.stage==="thinking"&&!cycle.suspendedAt)||
      (result.outcome==="temporarily_unavailable"&&cycle.stage==="consultation_result"&&cycle.suspendedAt&&cycle.suspensionReason==="temporarily_unavailable")
    ))throw new Error("Повторный контакт сейчас недоступен");
    const [closed]=await tx.select({id:followUpClosures.id}).from(followUpClosures).where(eq(followUpClosures.resultId,result.id));
    if(closed)throw new Error("Контакт закрыт. Требуется повторная оценка");
    const clock=await tx.execute(sql`select now() as now`),rows=Array.isArray(clock)?clock:(clock as unknown as {rows:{now:Date|string}[]}).rows;
    const now=new Date((rows[0] as {now:Date|string}).now),dueAt=new Date(data.dueAt);
    if(dueAt<=now)throw new Error("Дата должна быть в будущем");
    const [previous]=await tx.select().from(followUpRevisions).where(eq(followUpRevisions.resultId,result.id)).orderBy(desc(followUpRevisions.sequence)).limit(1);
    if(dueAt.getTime()===(previous?.dueAt??result.followUpAt??result.reassessmentAt)!.getTime())throw new Error("Укажите новую дату");
    const [revision]=await tx.insert(followUpRevisions).values({studioId:context.studioId,resultId:result.id,sequence:(previous?.sequence??0)+1,dueAt,actorId:context.userId,commandId,reason:data.reason,comment:data.comment}).returning();
    await tx.update(tasks).set({status:"cancelled",updatedAt:now}).where(and(eq(tasks.followUpResultId,result.id),eq(tasks.studioId,context.studioId),inArray(tasks.status,["pending","in_progress"])));
    const after=await recordCycleChange(tx,context,commandId,cycle,cycle.stage,"Специалист перенёс дату повторного контакта");
    await enqueue(tx,{studioId:context.studioId,eventKey:revision.id,handler:"cycle.follow-up-due.v1",availableAt:dueAt},{resultId:result.id,revisionId:revision.id});
    return {id:cycle.id,version:after.version,fromVersion:cycle.version,revisionId:revision.id};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");});
  revalidatePath(`/deals/${response.id}`);revalidatePath("/deals");return response;
}
