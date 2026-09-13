import "server-only";
import { and,eq,inArray,sql } from "drizzle-orm";
import { consultationResults,consultations,followUpClosures,tasks,treatmentCycles } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import type { CycleContext } from "./scope";
// Internal command hook; caller holds the studio lock. Closure is permanent for
// this decision, so restoring a client cannot revive an obsolete queued contact.
export async function closeCycleFollowUps(tx:Transaction,context:CycleContext,cycleId:string,reason:"cycle_left_branch"|"client_archived") {
 const results=await tx.select({id:consultationResults.id}).from(consultationResults).innerJoin(consultations,eq(consultations.id,consultationResults.consultationId)).where(and(eq(consultations.cycleId,cycleId),eq(consultationResults.studioId,context.studioId),inArray(consultationResults.outcome,["client_thinking","temporarily_unavailable"])));
 if(!results.length)return;
 await tx.insert(followUpClosures).values(results.map(r=>({studioId:context.studioId,resultId:r.id,actorId:context.userId,reason}))).onConflictDoNothing();
 await tx.update(tasks).set({status:"cancelled",updatedAt:sql`now()`}).where(and(eq(tasks.studioId,context.studioId),inArray(tasks.followUpResultId,results.map(r=>r.id)),inArray(tasks.status,["pending","in_progress"])));
}
export async function closeClientFollowUps(tx:Transaction,context:CycleContext,clientId:string) {
 const cycles=await tx.select({id:treatmentCycles.id}).from(treatmentCycles).where(and(eq(treatmentCycles.clientId,clientId),eq(treatmentCycles.studioId,context.studioId)));
 for(const cycle of cycles)await closeCycleFollowUps(tx,context,cycle.id,"client_archived");
}
