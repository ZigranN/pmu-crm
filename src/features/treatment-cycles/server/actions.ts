"use server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { clients, masters, treatmentCycles, cycleStageHistory } from "@/db/schema";
import { requireStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { idempotentCommand } from "@/server/commands/idempotency";
import { writeAudit } from "@/server/services/audit-log.service";
import { enqueue } from "@/server/events/outbox";
import { CYCLE_STAGES } from "../schemas/cycle.schema";
import { guardedTransition } from "./transitions";
import { lockCycle } from "./scope";
const createSchema=z.object({clientId:z.string().uuid(),zoneCode:z.enum(["brows","eyes","lips"]),reason:z.string().trim().min(3).max(1000)}).strict();
const transitionSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),to:z.enum(CYCLE_STAGES),reason:z.string().trim().min(3).max(1000)}).strict();
export async function createCycleAction(input:z.infer<typeof createSchema>,requestKey:string) {
  const data=createSchema.parse(input),context=await requireStudioPermission("CLIENT_UPDATE");
  const result=await idempotentCommand(context,"CLIENT_UPDATE","cycle.create.v1",requestKey,data,async(tx,commandId)=>{
    const client=await lockClient(tx,data.clientId,context.studioId,context.userId,false,"CLIENT_UPDATE");
    // Use the existing human assignment. This command cannot appoint a different master.
    if(client.assignedMasterId) {
      const [master]=await tx.select({id:masters.id}).from(masters).where(and(eq(masters.id,client.assignedMasterId),eq(masters.studioId,context.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
      if(!master) throw new Error("Назначенный мастер недоступен");
    }
    const [created]=await tx.insert(treatmentCycles).values({studioId:context.studioId,clientId:client.id,zoneCode:data.zoneCode,kind:"pmu",assignedMasterId:client.assignedMasterId}).returning();
    await tx.insert(cycleStageHistory).values({studioId:context.studioId,cycleId:created.id,commandId,actorId:context.userId,fromStage:null,toStage:created.stage,version:created.version,reason:data.reason});
    await writeAudit(tx,{...context,action:"cycle_created",entityType:"treatment_cycle",entityId:created.id,before:null,after:created,reason:data.reason,reasonSource:"user",metadata:{commandId}});
    await enqueue(tx,{studioId:context.studioId,eventKey:commandId,handler:"cycle.stage-recorded.v1"},{cycleId:created.id,version:created.version,commandId});
    return {id:created.id,version:created.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);});
  revalidatePath("/deals");return result;
}
export async function transitionCycleAction(input:z.infer<typeof transitionSchema>,requestKey:string) {
  const data=transitionSchema.parse(input),context=await requireStudioPermission("CLIENT_UPDATE");
  const result=await idempotentCommand(context,"CLIENT_UPDATE","cycle.transition.v1",requestKey,data,async(tx,commandId)=>{
    const before=await lockCycle(tx,context,data.id);
    if(before.version!==data.expectedVersion) throw new Error("Цикл изменён. Обновите страницу перед следующим действием");
    const [client]=await tx.select().from(clients).where(eq(clients.id,before.clientId));
    const blocked=await guardedTransition(tx,before,data.to,client);if(blocked) throw new Error(blocked);
    const [after]=await tx.update(treatmentCycles).set({stage:data.to,version:before.version+1,updatedAt:new Date(),...(data.to==="consultation_needed"?{assignedMasterId:before.assignedMasterId??client.assignedMasterId}:{})}).where(and(eq(treatmentCycles.id,before.id),eq(treatmentCycles.version,data.expectedVersion))).returning();
    if(!after) throw new Error("Цикл изменён");
    await tx.insert(cycleStageHistory).values({studioId:context.studioId,cycleId:after.id,commandId,actorId:context.userId,fromStage:before.stage,toStage:after.stage,version:after.version,reason:data.reason});
    await writeAudit(tx,{...context,action:"cycle_stage_changed",entityType:"treatment_cycle",entityId:after.id,before:{stage:before.stage,version:before.version,assignedMasterId:before.assignedMasterId},after:{stage:after.stage,version:after.version,assignedMasterId:after.assignedMasterId},reason:data.reason,reasonSource:"user",metadata:{commandId}});
    await enqueue(tx,{studioId:context.studioId,eventKey:commandId,handler:"cycle.stage-recorded.v1"},{cycleId:after.id,version:after.version,commandId});
    return {id:after.id,version:after.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);});
  revalidatePath("/deals");revalidatePath(`/deals/${result.id}`);return result;
}
