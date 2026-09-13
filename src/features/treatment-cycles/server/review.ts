"use server";
import { and,desc,eq,isNull,sql } from "drizzle-orm";
import type { z } from "zod";
import { revalidatePath } from "next/cache";
import { clients,masters,treatmentCycles,consultations,consultationResults,cycleReviews,cycleQualifications } from "@/db/schema";
import { cycleReviewSchema } from "@/features/consultations/contracts";
import { evaluateQualification } from "@/features/consultations/server/qualification";
import { requireStudioPermission } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { idempotentCommand } from "@/server/commands/idempotency";
import { lockCycle } from "./scope";
import { recordCycleChange } from "./mutation";
import { closeCycleFollowUps } from "./close-followups";
export async function reviewCycleAction(input:z.infer<typeof cycleReviewSchema>,key:string) {
 const data=cycleReviewSchema.parse(input),context=await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
 const response=await idempotentCommand(context,"MEDICAL_PROFILE_UPDATE","cycle.review.v1",key,data,async(tx,commandId)=>{
  if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");
  const cycle=await lockCycle(tx,context,data.id);
  if(cycle.version!==data.expectedVersion)throw new Error("Цикл изменён. Обновите данные");
  const [latest]=await tx.select().from(consultations).where(and(eq(consultations.cycleId,cycle.id),eq(consultations.studioId,context.studioId))).orderBy(desc(consultations.completedAt),desc(consultations.id)).limit(1);
  const [result]=latest?await tx.select().from(consultationResults).where(eq(consultationResults.consultationId,latest.id)):[];
  const [remover]=await tx.select({id:treatmentCycles.id}).from(treatmentCycles).where(and(eq(treatmentCycles.originCycleId,cycle.id),eq(treatmentCycles.kind,"remover"))).limit(1);
  if(cycle.kind!=="pmu"||cycle.packageId||cycle.firstSessionAt||cycle.secondSessionAt||cycle.completedAt||remover||result?.outcome==="removal_required"||(cycle.suspendedAt&&cycle.suspensionReason!=="temporarily_unavailable"))throw new Error("Требуется отдельный процесс процедур, пакета или Remover");
  const resume=data.operation==="reassess";
  const allowed=resume?(cycle.stage==="lost"||cycle.stage==="thinking"||(cycle.stage==="consultation_result"&&cycle.suspensionReason==="temporarily_unavailable")):["new_lead","qualification","consultation_needed","consultation_offered","thinking","consultation_result"].includes(cycle.stage);
  if(!allowed||(latest&&!result))throw new Error("Повторная оценка или Lost сейчас недоступны");
  // A pre-treatment exit/reassessment cannot silently cancel appointments,
  // settle money, or change a procedure/package lifecycle owned by later phases.
  const dependencies=await tx.execute(sql`select 1 from appointment_cycles l join appointments a on a.id=l.appointment_id where l.cycle_id=${cycle.id} and (l.visit_kind<>'consultation' or a.status not in ('completed','cancelled') or exists(select 1 from payments p where p.appointment_id=a.id) or exists(select 1 from payment_transactions p where p.appointment_id=a.id))
    union all select 1 from procedure_sessions p where p.cycle_id=${cycle.id} limit 1`);
  const depRows=Array.isArray(dependencies)?dependencies:(dependencies as unknown as {rows:unknown[]}).rows;
  if(depRows.length)throw new Error("Сначала требуется решение по связанным визитам, процедурам или оплатам");
  const [client]=await tx.select().from(clients).where(eq(clients.id,cycle.clientId));
  const clock=await tx.execute(sql`select now() as now`),rows=Array.isArray(clock)?clock:(clock as unknown as {rows:{now:Date|string}[]}).rows,now=new Date((rows[0] as {now:Date|string}).now);
  let after;
  if(resume){
   const [master]=await tx.select().from(masters).where(and(eq(masters.id,cycle.assignedMasterId??client.assignedMasterId??"00000000-0000-0000-0000-000000000000"),eq(masters.studioId,context.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
   if(!master||!client.language||!client.clientKind||client.reportedPreviousPmu===null||!client.interestedZones?.includes(cycle.zoneCode))throw new Error("Заполните квалификацию клиента и назначьте активного мастера");
   const risks={otherMasterPmu:data.otherMasterPmu,doubt:data.doubt,conditionChanged:data.conditionChanged,evaluationRequired:data.evaluationRequired};
   const evidence=await evaluateQualification(tx,{...cycle,assignedMasterId:master.id},client,risks,now);
   after=await recordCycleChange(tx,context,commandId,cycle,evidence.consultationRequired?"consultation_needed":"qualification","Повторная оценка специалиста: цикл возобновлён","cycle_qualified",{assignedMasterId:master.id,suspendedAt:null,suspensionReason:null});
   await tx.insert(cycleQualifications).values({studioId:context.studioId,cycleId:cycle.id,actorId:context.userId,commandId,cycleVersion:after.version,...risks,consultationRequired:evidence.consultationRequired,evidence,reason:data.reason});
  }else after=await recordCycleChange(tx,context,commandId,cycle,"lost","Специалист закрыл запрос клиента как Lost");
  await closeCycleFollowUps(tx,context,cycle.id,"cycle_left_branch");
  const [review]=await tx.insert(cycleReviews).values({studioId:context.studioId,cycleId:cycle.id,resultId:result?.id??null,commandId,actorId:context.userId,operation:data.operation,reason:data.reason,comment:data.comment}).returning();
  return {id:cycle.id,version:after.version,fromVersion:cycle.version,reviewId:review.id};
 },async(tx,result)=>{await lockCycle(tx,context,result.id);if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");});
 revalidatePath(`/deals/${response.id}`);revalidatePath("/deals");return response;
}
