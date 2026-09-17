import { z } from "zod";
import { and, eq, isNull, desc, getTableColumns } from "drizzle-orm";
import { clients, treatmentCycles, cycleStageHistory, user } from "@/db/schema";
import { resourceScope } from "@/server/auth/scopes";
import { cycleScope, lockCycle } from "./scope";
import { guardedTransition } from "./transitions";
import { TRANSITIONS, type CycleStage } from "../stages";
import "server-only";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { lockStudioAccess } from "@/server/auth/scopes";
import { sensitiveRead } from "@/server/services/access-log.service";
import { inspectLegacyCycles } from "./legacy-report";
export async function getLegacyCycleReport() {
  return sensitiveRead("STUDIO_MANAGE",undefined,{operation:"cycles.legacy.report"},context=>db.transaction(async tx=>{
    await lockStudioAccess(tx,context);
    if(!await hasPermission(tx,context.userId,context.studioId,"STUDIO_MANAGE")) throw new Error("Permission denied");
    return inspectLegacyCycles(tx,context.studioId);
  }),result=>result.entries.map(row=>row.id));
}

export async function getCycleBoard() {
  return sensitiveRead("CLIENT_READ",undefined,{operation:"cycles.list"},context=>db.transaction(async tx=>{
    await lockStudioAccess(tx,context);
    if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_READ")) throw new Error("Permission denied");
    const scope=await resourceScope(context,tx);
    const rows=await tx.select({id:treatmentCycles.id,clientId:treatmentCycles.clientId,name:clients.fullName,zone:treatmentCycles.zoneCode,stage:treatmentCycles.stage,version:treatmentCycles.version})
      .from(treatmentCycles).innerJoin(clients,eq(clients.id,treatmentCycles.clientId)).where(await cycleScope(context,tx)).orderBy(desc(treatmentCycles.updatedAt),treatmentCycles.id).limit(501);
    const choices=await tx.select({id:clients.id,name:clients.fullName}).from(clients).where(and(scope.client,isNull(clients.deletedAt),isNull(clients.mergedIntoId))).orderBy(clients.fullName,clients.id).limit(501);
    return {rows:rows.slice(0,500),clients:choices.slice(0,500),truncated:rows.length>500||choices.length>500,canWrite:await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE")};
  }),result=>[...new Set([...result.rows.map(row=>row.id),...result.clients.map(row=>row.id)])]);
}
export async function getCycleTimeline(id:string) {
  z.string().uuid().parse(id);
  return sensitiveRead("CLIENT_READ",undefined,{operation:"cycles.timeline",targetId:id},context=>db.transaction(async tx=>{
    await lockStudioAccess(tx,context);
    if(!await hasPermission(tx,context.userId,context.studioId,"CLIENT_READ")) throw new Error("Permission denied");
    const cycle=await lockCycle(tx,context,id);
    const [client]=await tx.select().from(clients).where(eq(clients.id,cycle.clientId));
    const history=await tx.select({...getTableColumns(cycleStageHistory),actorName:user.name}).from(cycleStageHistory).leftJoin(user,eq(user.id,cycleStageHistory.actorId)).where(and(eq(cycleStageHistory.cycleId,id),eq(cycleStageHistory.studioId,context.studioId))).orderBy(desc(cycleStageHistory.version)).limit(1001);
    return {id:cycle.id,clientId:cycle.clientId,name:client.fullName,zone:cycle.zoneCode,stage:cycle.stage,version:cycle.version,
      choices:await Promise.all(TRANSITIONS[cycle.stage as CycleStage].map(async to=>({to,blocked:await guardedTransition(tx,cycle,to,client)}))),
      history:history.slice(0,1000),truncated:history.length>1000,canWrite:await hasPermission(tx,context.userId,context.studioId,"CLIENT_UPDATE")};
  }),result=>[result.id,...result.history.map(row=>row.id)]);
}
