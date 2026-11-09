"use server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { masters, treatmentCycles } from "@/db/schema";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { idempotentCommand } from "@/server/commands/idempotency";
import { recordCycleChange, recordCycleEvidence } from "./mutation";
import { CYCLE_STAGES } from "../schemas/cycle.schema";
import { guardedTransition } from "./transitions";
import { lockCycle } from "./scope";
const createSchema=z.object({clientId:z.string().uuid(),zoneCode:z.enum(["brows","eyes","lips"]),reason:z.string().trim().min(3).max(1000)}).strict();
const createRemoverSchema=z.object({clientId:z.string().uuid(),zoneCode:z.enum(["brows","eyes","lips","skin","lashes"]),originCycleId:z.string().uuid().optional(),reason:z.string().trim().min(3).max(1000)}).strict();
const transitionSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),to:z.enum(CYCLE_STAGES),reason:z.string().trim().min(3).max(1000)}).strict();
export async function createCycleAction(input:z.infer<typeof createSchema>,requestKey:string) {
  const data=createSchema.parse(input),context=await requireBrowserStudioPermission("CLIENT_UPDATE");
  const result=await idempotentCommand(context,"CLIENT_UPDATE","cycle.create.v1",requestKey,data,async(tx,commandId)=>{
    const client=await lockClient(tx,data.clientId,context.studioId,context.userId,false,"CLIENT_UPDATE");
    // Use the existing human assignment. This command cannot appoint a different master.
    if(client.assignedMasterId) {
      const [master]=await tx.select({id:masters.id}).from(masters).where(and(eq(masters.id,client.assignedMasterId),eq(masters.studioId,context.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
      if(!master) throw new Error("Назначенный мастер недоступен");
    }
    const [created]=await tx.insert(treatmentCycles).values({studioId:context.studioId,clientId:client.id,zoneCode:data.zoneCode,kind:"pmu",assignedMasterId:client.assignedMasterId}).returning();
    await recordCycleEvidence(tx,context,commandId,null,created,data.reason,"cycle_created","user");
    return {id:created.id,version:created.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);});
  revalidatePath("/deals");return result;
}
export async function createRemoverCycleAction(input:z.infer<typeof createRemoverSchema>,requestKey:string) {
  const data=createRemoverSchema.parse(input),context=await requireBrowserStudioPermission("CLIENT_UPDATE");
  const result=await idempotentCommand(context,"CLIENT_UPDATE","remover.create.v1",requestKey,data,async(tx,commandId)=>{
    const client=await lockClient(tx,data.clientId,context.studioId,context.userId,false,"CLIENT_UPDATE");
    if(data.originCycleId) {
      const [origin]=await tx.select({id:treatmentCycles.id}).from(treatmentCycles).where(and(eq(treatmentCycles.id,data.originCycleId),eq(treatmentCycles.clientId,client.id),eq(treatmentCycles.studioId,context.studioId)));
      if(!origin) throw new Error("Исходный цикл не найден в данной студии");
    }
    if(client.assignedMasterId) {
      const [master]=await tx.select({id:masters.id}).from(masters).where(and(eq(masters.id,client.assignedMasterId),eq(masters.studioId,context.studioId),eq(masters.isActive,true),isNull(masters.deletedAt)));
      if(!master) throw new Error("Назначенный мастер недоступен");
    }
    const [created]=await tx.insert(treatmentCycles).values({studioId:context.studioId,clientId:client.id,zoneCode:data.zoneCode,kind:"remover",originCycleId:data.originCycleId??null,assignedMasterId:client.assignedMasterId}).returning();
    await recordCycleEvidence(tx,context,commandId,null,created,data.reason,"remover_cycle_created","user");
    return {id:created.id,version:created.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);});
  revalidatePath("/deals");revalidatePath(`/clients/${data.clientId}`);return result;
}
export async function transitionCycleAction(input:z.infer<typeof transitionSchema>,requestKey:string) {
  const data=transitionSchema.parse(input),context=await requireBrowserStudioPermission("CLIENT_UPDATE");
  const result=await idempotentCommand(context,"CLIENT_UPDATE","cycle.transition.v1",requestKey,data,async(tx,commandId)=>{
    const before=await lockCycle(tx,context,data.id);
    if(before.version!==data.expectedVersion) throw new Error("Цикл изменён. Обновите страницу перед следующим действием");
    const blocked=await guardedTransition(tx,before,data.to);if(blocked) throw new Error(blocked);
    const after=await recordCycleChange(tx,context,commandId,before,data.to,data.reason,"cycle_stage_changed",{},"user");
    return {id:after.id,version:after.version};
  },async(tx,result)=>{await lockCycle(tx,context,result.id);});
  revalidatePath("/deals");revalidatePath(`/deals/${result.id}`);return result;
}
