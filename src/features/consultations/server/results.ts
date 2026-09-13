"use server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { clients, masters, appointments, appointmentCycles, treatmentCycles, cycleQualifications, consultations, consultationResults, tasks } from "@/db/schema";
import { requireStudioPermission } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { idempotentCommand } from "@/server/commands/idempotency";
import { lockCycle, type CycleContext } from "@/features/treatment-cycles/server/scope";
import { recordCycleChange, recordCycleEvidence } from "@/features/treatment-cycles/server/mutation";
import { enqueue } from "@/server/events/outbox";
import type { Transaction } from "@/server/commands/ownership";
import { qualificationSchema,completionSchema,resultSchema } from "../contracts";
import { evaluateQualification } from "./qualification";
async function clinicalCycle(tx:Transaction,context:CycleContext,id:string,version:number) {
  if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");
  const cycle=await lockCycle(tx,context,id);if(cycle.version!==version)throw new Error("Цикл изменён. Обновите данные");
  if(cycle.kind!=="pmu"||cycle.suspendedAt)throw new Error("Цикл не допускает это действие");
  const [client]=await tx.select().from(clients).where(eq(clients.id,cycle.clientId));
  const [master]=await tx.select().from(masters).where(and(eq(masters.id,cycle.assignedMasterId??client.assignedMasterId??"00000000-0000-0000-0000-000000000000"),eq(masters.studioId,context.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
  if(!master)throw new Error("Назначьте активного мастера");
  const clock=await tx.execute(sql`select now() as now`);const rows=Array.isArray(clock)?clock:(clock as unknown as {rows:{now:Date|string}[]}).rows;
  return {cycle,client,master,now:new Date((rows[0] as {now:Date|string}).now)};
}
function invalidate(id:string){revalidatePath("/deals");revalidatePath(`/deals/${id}`);}
export async function qualifyCycleAction(input:z.input<typeof qualificationSchema>,key:string) {
  const data=qualificationSchema.parse(input),context=await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const result=await idempotentCommand(context,"MEDICAL_PROFILE_UPDATE","cycle.qualify.v1",key,data,async(tx,commandId)=>{
    const {cycle,client,master,now}=await clinicalCycle(tx,context,data.id,data.expectedVersion);
    if(!["qualification","consultation_needed"].includes(cycle.stage))throw new Error("Сначала откройте квалификацию");
    if(!client.language||!client.clientKind||client.reportedPreviousPmu===null||!client.interestedZones?.includes(cycle.zoneCode))throw new Error("Заполните административную квалификацию в карточке клиента");
    const risks={otherMasterPmu:data.otherMasterPmu,doubt:data.doubt,conditionChanged:data.conditionChanged,evaluationRequired:data.evaluationRequired};
    const evidence=await evaluateQualification(tx,{...cycle,assignedMasterId:master.id},client,risks,now);
    const after=await recordCycleChange(tx,context,commandId,cycle,evidence.consultationRequired?"consultation_needed":"qualification","Квалификация проверена специалистом","cycle_qualified",{assignedMasterId:master.id});
    await tx.insert(cycleQualifications).values({studioId:context.studioId,cycleId:cycle.id,actorId:context.userId,commandId,cycleVersion:after.version,...risks,consultationRequired:evidence.consultationRequired,evidence,reason:data.reason});
    return {id:cycle.id,version:after.version,fromVersion:cycle.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");});
  invalidate(result.id);return result;
}
export async function completeConsultationAction(input:z.infer<typeof completionSchema>,key:string) {
  const data=completionSchema.parse(input),context=await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const result=await idempotentCommand(context,"MEDICAL_PROFILE_UPDATE","consultation.complete.v1",key,data,async(tx,commandId)=>{
    const {cycle,master,now}=await clinicalCycle(tx,context,data.id,data.expectedVersion);
    if(!["consultation_scheduled","consultation_confirmed","consultation_completed"].includes(cycle.stage))throw new Error("Консультация должна быть назначена через календарь");
    if(!master.userId||!await hasPermission(tx,master.userId,context.studioId,"MEDICAL_PROFILE_UPDATE"))throw new Error("Мастер должен быть связан с активным пользователем-специалистом");
    const [visit]=await tx.select({appointment:appointments}).from(appointments).innerJoin(appointmentCycles,and(eq(appointmentCycles.appointmentId,appointments.id),eq(appointmentCycles.cycleId,cycle.id),eq(appointmentCycles.studioId,context.studioId),eq(appointmentCycles.clientId,cycle.clientId),eq(appointmentCycles.visitKind,"consultation")))
      .where(and(eq(appointments.id,data.appointmentId),eq(appointments.studioId,context.studioId),eq(appointments.clientId,cycle.clientId),eq(appointments.masterId,master.id),eq(appointments.status,"completed"),isNull(appointments.deletedAt)));
    if(!visit||visit.appointment.endAt>now)throw new Error("Нет завершённого визита-консультации этой зоны и мастера");
    const hours=z.coerce.number().int().min(1).max(168).parse(process.env.CONSULTATION_DECISION_SLA_HOURS??24);
    const [record]=await tx.insert(consultations).values({studioId:context.studioId,cycleId:cycle.id,appointmentId:data.appointmentId,masterId:master.id,completedBy:context.userId,completionReason:data.reason,completedAt:visit.appointment.endAt,decisionDueAt:new Date(visit.appointment.endAt.getTime()+hours*3600000)}).returning();
    let after=cycle;
    if(after.stage!=="consultation_completed")after=await recordCycleChange(tx,context,commandId,after,"consultation_completed","Завершение консультации подтверждено специалистом","consultation_completed");
    after=await recordCycleChange(tx,context,commandId,after,"consultation_result_required","Требуется результат консультации");
    await enqueue(tx,{studioId:context.studioId,eventKey:record.id,handler:"consultation.decision-due.v1",availableAt:record.decisionDueAt},{consultationId:record.id});
    return {id:cycle.id,version:after.version,fromVersion:cycle.version,consultationId:record.id};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");});
  invalidate(result.id);return result;
}
export async function recordConsultationResultAction(input:z.input<typeof resultSchema>,key:string) {
  const data=resultSchema.parse(input),context=await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const result=await idempotentCommand(context,"MEDICAL_PROFILE_UPDATE","consultation.result.v1",key,data,async(tx,commandId)=>{
    const {cycle,now}=await clinicalCycle(tx,context,data.id,data.expectedVersion);
    if(cycle.stage!=="consultation_result_required")throw new Error("Результат сейчас не ожидается");
    const [consultation]=await tx.select().from(consultations).where(and(eq(consultations.id,data.consultationId),eq(consultations.cycleId,cycle.id),eq(consultations.studioId,context.studioId),isNull(consultations.resultRecordedAt)));
    if(!consultation)throw new Error("Консультация недоступна или решение уже записано");
    const reassessmentAt=data.reassessmentAt?new Date(data.reassessmentAt):null;if(reassessmentAt&&reassessmentAt<=now)throw new Error("Дата повторной оценки должна быть в будущем");
    let removerCycleId:string|null=null;
    if(data.outcome==="removal_required") {
      const [remover]=await tx.insert(treatmentCycles).values({studioId:context.studioId,clientId:cycle.clientId,zoneCode:cycle.zoneCode,kind:"remover",originCycleId:cycle.id,assignedMasterId:cycle.assignedMasterId}).returning();
      removerCycleId=remover.id;await recordCycleEvidence(tx,context,commandId,null,remover,"Remover создан по решению специалиста","cycle_created");
    }
    const [decision]=await tx.insert(consultationResults).values({studioId:context.studioId,consultationId:consultation.id,actorId:context.userId,commandId,outcome:data.outcome,reason:data.reason,comment:data.comment,reassessmentAt,followUpAt:data.outcome==="client_thinking"?new Date(now.getTime()+7*86400000):null,removerCycleId}).returning();
    const followUpDueAt=decision.followUpAt??decision.reassessmentAt;
    if(followUpDueAt)await enqueue(tx,{studioId:context.studioId,eventKey:decision.id,handler:"cycle.follow-up-due.v1",availableAt:followUpDueAt},{resultId:decision.id});
    const suspended=["removal_required","temporarily_unavailable"].includes(data.outcome);
    let after=await recordCycleChange(tx,context,commandId,cycle,"consultation_result","Результат консультации записан специалистом","consultation_result_recorded",suspended?{suspendedAt:now,suspensionReason:data.outcome}:{});
    if(data.outcome==="client_thinking")after=await recordCycleChange(tx,context,commandId,after,"thinking","Клиент обдумывает предложение");
    if(data.outcome==="master_cannot_help")after=await recordCycleChange(tx,context,commandId,after,"lost","Мастер не может помочь по этому запросу");
    await tx.update(consultations).set({resultRecordedAt:now}).where(eq(consultations.id,consultation.id));
    await tx.update(tasks).set({status:"completed",completedAt:now,updatedAt:now}).where(eq(tasks.consultationId,consultation.id));
    return {id:cycle.id,version:after.version,fromVersion:cycle.version,removerCycleId};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE"))throw new Error("Permission denied");});
  invalidate(result.id);return result;
}
