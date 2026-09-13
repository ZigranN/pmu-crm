import "server-only";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import { appointments, procedureSessions, treatmentCycles, clients, studios, masters, services } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
export function withinTwoCalendarYears(performed:Date,now:Date,timeZone:string) {
  if(performed>now)return false;
  const parts=(date:Date)=>{const map=Object.fromEntries(new Intl.DateTimeFormat("en",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).map(p=>[p.type,p.value]));return [+map.year,+map.month,+map.day];};
  const [year,month,day]=parts(now),cutoffDay=Math.min(day,new Date(Date.UTC(year-2,month,0)).getUTCDate());
  const key=([y,m,d]:number[])=>y*10000+m*100+d;
  return key(parts(performed))>=key([year-2,month,cutoffDay]);
}
export type Risks={otherMasterPmu:boolean;doubt:boolean;conditionChanged:boolean;evaluationRequired:boolean};
// Re-evaluate live CRM evidence whenever booking later consumes this decision.
export async function evaluateQualification(tx:Transaction,cycle:typeof treatmentCycles.$inferSelect,client:typeof clients.$inferSelect,risks:Risks,now:Date) {
  const [studio]=await tx.select().from(studios).where(eq(studios.id,cycle.studioId));
  const history=await tx.select({id:procedureSessions.id,masterId:procedureSessions.masterId,performedAt:appointments.endAt})
    .from(procedureSessions).innerJoin(appointments,and(eq(appointments.id,procedureSessions.appointmentId),eq(appointments.studioId,cycle.studioId),eq(appointments.clientId,client.id),eq(appointments.masterId,procedureSessions.masterId)))
    .innerJoin(masters,and(eq(masters.id,procedureSessions.masterId),eq(masters.studioId,cycle.studioId)))
    .innerJoin(services,and(eq(services.id,procedureSessions.serviceId),eq(services.studioId,cycle.studioId)))
    .innerJoin(treatmentCycles,and(eq(treatmentCycles.id,procedureSessions.cycleId),eq(treatmentCycles.studioId,cycle.studioId),eq(treatmentCycles.clientId,client.id),eq(treatmentCycles.zoneCode,cycle.zoneCode),inArray(treatmentCycles.kind,["pmu","refresh","paid_correction","free_correction"])))
    .where(and(eq(procedureSessions.studioId,cycle.studioId),eq(procedureSessions.clientId,client.id),eq(procedureSessions.procedureArea,cycle.zoneCode as "brows"|"eyes"|"lips"),inArray(procedureSessions.sessionType,["primary_session","second_session","refresh","correction","touch_up"]),eq(appointments.status,"completed"),isNull(appointments.deletedAt),isNull(procedureSessions.deletedAt)))
    .orderBy(desc(appointments.endAt),procedureSessions.id).limit(1);
  const latest=history[0],reasons:string[]=[];
  if(client.clientKind!=="returning")reasons.push("not_returning");
  if(!latest)reasons.push("no_verified_same_zone_history");
  else {if(!withinTwoCalendarYears(latest.performedAt,now,studio.timezone))reasons.push("outside_two_years");if(latest.masterId!==cycle.assignedMasterId)reasons.push("different_master_history");}
  for(const [risk,value] of Object.entries(risks))if(value)reasons.push(risk);
  return {consultationRequired:reasons.length>0,reasons,procedureId:latest?.id??null,performedAt:latest?.performedAt.toISOString()??null,evaluatedAt:now.toISOString(),timeZone:studio.timezone};
}

export async function evaluateCurrentQualification(tx:Transaction,cycle:typeof treatmentCycles.$inferSelect,client:typeof clients.$inferSelect,now:Date) {
  const {cycleQualifications}=await import("@/db/schema");
  const [last]=await tx.select().from(cycleQualifications).where(and(eq(cycleQualifications.cycleId,cycle.id),eq(cycleQualifications.studioId,cycle.studioId))).orderBy(desc(cycleQualifications.cycleVersion)).limit(1);
  if(!last)return {consultationRequired:true,reasons:["qualification_missing"]};
  // Never trust the saved boolean: timing, canonical client, master and completed visits may change.
  return evaluateQualification(tx,cycle,client,{otherMasterPmu:last.otherMasterPmu,doubt:last.doubt,conditionChanged:last.conditionChanged,evaluationRequired:last.evaluationRequired},now);
}
