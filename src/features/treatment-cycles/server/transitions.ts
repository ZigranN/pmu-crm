import "server-only";
import { TRANSITIONS, REQUIRED_COMMAND, GENERIC_ALLOWED_EDGES, type CycleStage } from "../stages";
import type { treatmentCycles } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";

export function transitionBlock(cycle:typeof treatmentCycles.$inferSelect,to:CycleStage):string|null {
  if(cycle.kind!=="pmu") return "Для этого типа цикла требуется отдельный процесс";
  if(cycle.suspendedAt) return "Цикл приостановлен: требуется решение мастера";
  const edges=TRANSITIONS[cycle.stage as CycleStage];
  if(!edges?.includes(to)) return "Переход между этими стадиями запрещён";
  if(to==="lost") return "Требуется закрытие через оценку специалиста";
  if(cycle.stage==="qualification"&&to==="consultation_needed") return "Требуется квалификация специалистом";
  if(cycle.stage==="consultation_needed"&&to==="qualification") return "Требуется повторная квалификация специалистом";
  if(["thinking","consultation_result","lost"].includes(cycle.stage)&&["qualification","consultation_needed"].includes(to)) return "Требуется повторная оценка специалиста";
  if(REQUIRED_COMMAND[to]) return `Требуется: ${REQUIRED_COMMAND[to]}`;
  if(!GENERIC_ALLOWED_EDGES.has(`${cycle.stage}->${to}`)) return "Требуется специализированная команда для этого перехода";
  return null;
}

export async function guardedTransition(_tx:Transaction,cycle:typeof treatmentCycles.$inferSelect,to:CycleStage) {
  const blocked=transitionBlock(cycle,to);
  if(blocked) return blocked;
  return null;
}
