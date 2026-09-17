import "server-only";
import { TRANSITIONS, REQUIRED_COMMAND, type CycleStage } from "../stages";
import type { clients, treatmentCycles } from "@/db/schema";
export function transitionBlock(cycle:typeof treatmentCycles.$inferSelect,to:CycleStage,client:typeof clients.$inferSelect):string|null {
  if(cycle.kind!=="pmu") return "Для этого типа цикла требуется отдельный процесс";
  if(cycle.suspendedAt) return "Цикл приостановлен: требуется решение мастера";
  const edges=TRANSITIONS[cycle.stage as CycleStage];
  if(!edges?.includes(to)) return "Переход между этими стадиями запрещён";
  if(to==="lost" && !["new_lead","qualification","consultation_needed","consultation_offered"].includes(cycle.stage)) return "Сначала требуется отмена записи или решение по консультации и оплатам";
  if(cycle.stage==="consultation_needed"&&to==="qualification")return "Требуется повторная квалификация специалистом";
  if(REQUIRED_COMMAND[to]) return `Требуется: ${REQUIRED_COMMAND[to]}`;
  if(to==="consultation_needed" && (!client.language || !client.clientKind || client.reportedPreviousPmu===null || !client.interestedZones?.includes(cycle.zoneCode) || !(cycle.assignedMasterId??client.assignedMasterId))) return "Заполните язык, тип клиента, предыдущий PMU, интересующую зону и назначьте мастера";
  return null;
}

import { and, eq, isNull } from "drizzle-orm";
import { masters, appointmentCycles, procedureSessions } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
export async function guardedTransition(tx:Transaction,cycle:typeof treatmentCycles.$inferSelect,to:CycleStage,client:typeof clients.$inferSelect) {
  const blocked=transitionBlock(cycle,to,client);if(blocked) return blocked;
  if(to==="consultation_needed") {
    const [master]=await tx.select({id:masters.id}).from(masters).where(and(eq(masters.id,(cycle.assignedMasterId??client.assignedMasterId)!),eq(masters.studioId,cycle.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
    if(!master) return "Назначенный мастер недоступен";
  }
  if(to==="lost") {
    const [visit]=await tx.select({id:appointmentCycles.id}).from(appointmentCycles).where(eq(appointmentCycles.cycleId,cycle.id)).limit(1);
    const [procedure]=await tx.select({id:procedureSessions.id}).from(procedureSessions).where(eq(procedureSessions.cycleId,cycle.id)).limit(1);
    if(visit||procedure) return "У цикла уже есть визиты или процедуры: требуется отдельное решение по их завершению или отмене";
  }
  return null;
}
