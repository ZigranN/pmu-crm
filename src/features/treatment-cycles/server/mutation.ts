import "server-only";
import { eq, and } from "drizzle-orm";
import { treatmentCycles, cycleStageHistory } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import type { CycleContext } from "./scope";
import type { CycleStage } from "../stages";
import type { AuditAction } from "@/lib/audit-contract";
import { writeAudit } from "@/server/services/audit-log.service";
import { enqueue } from "@/server/events/outbox";
// Internal persistence boundary. Callers own permissions, state/evidence guards and the receipt transaction.
export async function recordCycleChange(tx:Transaction,context:CycleContext,commandId:string,before:typeof treatmentCycles.$inferSelect,to:CycleStage,reason:string,action:AuditAction="cycle_stage_changed",patch:Partial<Pick<typeof treatmentCycles.$inferInsert,"assignedMasterId"|"suspendedAt"|"suspensionReason">>={},reasonSource:"user"|"command"="command") {
  const [after]=await tx.update(treatmentCycles).set({...patch,stage:to,version:before.version+1,updatedAt:new Date()}).where(and(eq(treatmentCycles.id,before.id),eq(treatmentCycles.version,before.version))).returning();
  if(!after)throw new Error("Цикл изменён");
  await recordCycleEvidence(tx,context,commandId,before,after,reason,action,reasonSource);return after;
}
export async function recordCycleEvidence(tx:Transaction,context:CycleContext,commandId:string,before:typeof treatmentCycles.$inferSelect|null,after:typeof treatmentCycles.$inferSelect,reason:string,action:AuditAction,reasonSource:"user"|"command"="command") {
  await tx.insert(cycleStageHistory).values({studioId:context.studioId,cycleId:after.id,commandId,actorId:context.userId,fromStage:before?.stage??null,toStage:after.stage,version:after.version,reason});
  const snapshot=(row:typeof after)=>({clientId:row.clientId,zoneCode:row.zoneCode,kind:row.kind,originCycleId:row.originCycleId,stage:row.stage,version:row.version,assignedMasterId:row.assignedMasterId,suspendedAt:row.suspendedAt,suspensionReason:row.suspensionReason});
  await writeAudit(tx,{...context,action,entityType:"treatment_cycle",entityId:after.id,before:before?snapshot(before):null,after:snapshot(after),reason,reasonSource,metadata:{commandId}});
  await enqueue(tx,{studioId:context.studioId,eventKey:`${commandId}:${after.id}:${after.version}`,handler:"cycle.stage-recorded.v1"},{cycleId:after.id,version:after.version,commandId});
}
