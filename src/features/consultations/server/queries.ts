import "server-only";
import { evaluateCurrentQualification } from "./qualification";
import { z } from "zod";
import { and,eq,desc,isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients,consultations,consultationResults,cycleQualifications,appointments,appointmentCycles,tasks } from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";
import { hasPermission } from "@/lib/permissions";
import { lockStudioAccess } from "@/server/auth/scopes";
import { lockCycle } from "@/features/treatment-cycles/server/scope";
export async function getConsultationPanel(id:string) {
  z.string().uuid().parse(id);
  return sensitiveRead("MEDICAL_PROFILE_READ",undefined,{operation:"consultations.read",targetId:id},context=>db.transaction(async tx=>{
    await lockStudioAccess(tx,context);if(!await hasPermission(tx,context.userId,context.studioId,"MEDICAL_PROFILE_READ"))throw new Error("Permission denied");
    const cycle=await lockCycle(tx,context,id);
    const qualification=(await tx.select().from(cycleQualifications).where(and(eq(cycleQualifications.cycleId,id),eq(cycleQualifications.studioId,context.studioId))).orderBy(desc(cycleQualifications.cycleVersion)).limit(1))[0]??null;
    const sessions=await tx.select().from(consultations).where(and(eq(consultations.cycleId,id),eq(consultations.studioId,context.studioId))).orderBy(desc(consultations.completedAt)).limit(100);
    const latest=sessions[0]??null;
    const result=latest?(await tx.select().from(consultationResults).where(eq(consultationResults.consultationId,latest.id)))[0]??null:null;
    const task=latest?(await tx.select({id:tasks.id,status:tasks.status,dueAt:tasks.dueAt}).from(tasks).where(eq(tasks.consultationId,latest.id)))[0]??null:null;
    const visits=await tx.select({id:appointments.id,endAt:appointments.endAt}).from(appointments).innerJoin(appointmentCycles,and(eq(appointmentCycles.appointmentId,appointments.id),eq(appointmentCycles.cycleId,id),eq(appointmentCycles.studioId,context.studioId),eq(appointmentCycles.visitKind,"consultation"))).where(and(eq(appointments.studioId,context.studioId),eq(appointments.clientId,cycle.clientId),eq(appointments.status,"completed"),isNull(appointments.deletedAt))).orderBy(desc(appointments.endAt)).limit(100);
    const [client]=await tx.select().from(clients).where(eq(clients.id,cycle.clientId));
    const currentQualification=qualification?await evaluateCurrentQualification(tx,cycle,client,new Date()):null;
    return {currentQualification,id,version:cycle.version,stage:cycle.stage,kind:cycle.kind,suspended:Boolean(cycle.suspendedAt),qualification,latest,result,task,visits,canWrite:await hasPermission(tx,context.userId,context.studioId,"MEDICAL_PROFILE_UPDATE")&&await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE")};
  }),r=>[r.id,...(r.qualification?[r.qualification.id]:[]),...(r.latest?[r.latest.id]:[]),...(r.result?[r.result.id]:[]),...(r.task?[r.task.id]:[]),...r.visits.map(v=>v.id)]);
}
