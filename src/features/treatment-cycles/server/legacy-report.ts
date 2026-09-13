import "server-only";
import { and, eq, isNull, notExists } from "drizzle-orm";
import { appointments, appointmentCycles, procedureSessions, clients, services, serviceDefinitions } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
// Internal read-only inventory. Does not infer course grouping, stage, payment or medical decisions.
export async function inspectLegacyCycles(tx: Transaction, studioId: string) {
  const visits = await tx.select({id:appointments.id,clientId:appointments.clientId,clientStudio:clients.studioId,alias:clients.mergedIntoId,serviceStudio:services.studioId,zone:serviceDefinitions.zoneCode})
    .from(appointments).leftJoin(clients,eq(clients.id,appointments.clientId)).leftJoin(services,eq(services.id,appointments.serviceId)).leftJoin(serviceDefinitions,eq(serviceDefinitions.code,services.catalogCode))
    .where(and(eq(appointments.studioId,studioId),notExists(tx.select({id:appointmentCycles.id}).from(appointmentCycles).where(eq(appointmentCycles.appointmentId,appointments.id))))).orderBy(appointments.id).limit(1001);
  const sessions = await tx.select({id:procedureSessions.id,clientId:procedureSessions.clientId,clientStudio:clients.studioId,alias:clients.mergedIntoId,serviceStudio:services.studioId,zone:serviceDefinitions.zoneCode,area:procedureSessions.procedureArea,appointmentId:procedureSessions.appointmentId,visitClient:appointments.clientId,visitStudio:appointments.studioId})
    .from(procedureSessions).leftJoin(clients,eq(clients.id,procedureSessions.clientId)).leftJoin(services,eq(services.id,procedureSessions.serviceId)).leftJoin(serviceDefinitions,eq(serviceDefinitions.code,services.catalogCode)).leftJoin(appointments,eq(appointments.id,procedureSessions.appointmentId))
    .where(and(eq(procedureSessions.studioId,studioId),isNull(procedureSessions.cycleId))).orderBy(procedureSessions.id).limit(1001);
  const entries = [...visits.slice(0,1000).map(row=>({...row,kind:"appointment" as const})),...sessions.slice(0,1000).map(row=>({...row,kind:"procedure" as const}))].map(row=>{
    const reasons = ["manual_course_grouping_required"];
    if(row.clientStudio!==studioId || row.serviceStudio!==studioId) reasons.push("inconsistent_tenant");
    if(row.alias) reasons.push("merged_client_reference");
    if(!row.zone) reasons.push("catalog_mapping_required");
    if(row.zone==="cycle_zone") reasons.push("zone_selection_required");
    if(row.kind==="procedure" && row.appointmentId && (row.visitClient!==row.clientId || row.visitStudio!==studioId)) reasons.push("inconsistent_appointment_link");
    if(row.kind==="procedure" && (row.area==="total_look" || row.area==="other" || (row.zone && row.zone!=="cycle_zone" && row.area!==row.zone))) reasons.push("ambiguous_procedure_zone");
    return {id:row.id,kind:row.kind,clientId:row.clientId,catalogZone:row.zone,reasons};
  });
  return {entries,truncated:visits.length>1000 || sessions.length>1000,automaticConversions:0 as const};
}
