import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { treatmentCycles } from "@/db/schema";
import { db } from "@/db";
import { resourceScope } from "@/server/auth/scopes";
import type { Transaction } from "@/server/commands/ownership";
export type CycleContext = {studioId:string;userId:string};
export async function cycleScope(context:CycleContext, executor:typeof db|Transaction=db) {
  const scope=await resourceScope(context,executor);
  return and(eq(treatmentCycles.studioId,context.studioId),isNull(treatmentCycles.archivedAt),
    scope.clientReference(sql`${treatmentCycles.clientId}`),
    scope.isMaster ? scope.ownsMaster(sql`${treatmentCycles.assignedMasterId}`) : undefined)!;
}
export async function lockCycle(tx:Transaction,context:CycleContext,id:string) {
  const [cycle]=await tx.select().from(treatmentCycles).where(and(eq(treatmentCycles.id,id),await cycleScope(context,tx))).for("update");
  if(!cycle) throw new Error("Цикл недоступен");
  return cycle;
}
