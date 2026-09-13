"use server";
import { db } from "@/db";
import { clients, clientMerges } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { requireStudioPermission } from "@/server/auth/context";
import { lockStudioAccess } from "@/server/auth/scopes";
import { sensitiveRead, recordIds } from "@/server/services/access-log.service";
import { idempotentCommand } from "@/server/commands/idempotency";
import { lockClient } from "@/server/commands/ownership";
import { revalidatePath } from "next/cache";
import { pairSchema, mergeSchema, type MergeInput } from "../merge-contract";
import { authorizeMerge, inspectMerge, executeMerge, StaleMergeReview } from "./merge";
import { canonicalClientId } from "./identity";
export async function previewClientMerge(input: { sourceId: string; targetId: string }) {
  const pair = pairSchema.parse(input);
  return sensitiveRead("CLIENT_READ", undefined, { operation: "clients.merge.preview", targetId: pair.targetId }, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    return (await inspectMerge(tx, context, pair.sourceId, pair.targetId)).preview;
  }), result => [result.sourceId, result.targetId]);
}
export async function mergeClientsAction(input: MergeInput, requestKey: string) {
  const data = mergeSchema.parse(input), context = await requireStudioPermission("CLIENT_UPDATE");
  try {
    const result = await idempotentCommand(context, "CLIENT_UPDATE", "client.merge.v1", requestKey, data,
      (tx, commandId) => executeMerge(tx, context, data, commandId), async (tx, result) => {
        await authorizeMerge(tx, context);
        await lockClient(tx, await canonicalClientId(result.id, context.studioId, tx), context.studioId, context.userId, true, "CLIENT_READ");
      });
    revalidatePath("/clients"); revalidatePath(`/clients/${data.sourceId}`); revalidatePath(`/clients/${data.targetId}`);
    return { kind: "merged" as const, ...result };
  } catch (error) {
    if (error instanceof StaleMergeReview) return { kind: "stale" as const };
    throw error;
  }
}
export async function getClientMergeHistory(clientId: string) {
  return sensitiveRead("CLIENT_READ", undefined, { operation: "clients.merge.history", targetId: clientId }, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context); await authorizeMerge(tx, context);
    const id = await canonicalClientId(clientId, context.studioId, tx);
    await lockClient(tx, id, context.studioId, context.userId, true, "CLIENT_READ");
    const aliases = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.studioId, context.studioId), eq(clients.mergedIntoId, id)));
    return tx.select().from(clientMerges).where(and(eq(clientMerges.studioId, context.studioId), or(eq(clientMerges.targetId, id), ...aliases.map(row => eq(clientMerges.targetId, row.id))))).orderBy(clientMerges.createdAt);
  }), recordIds);
}

export async function getMergeCandidates(targetId: string) {
  return sensitiveRead("CLIENT_READ", undefined, { operation: "clients.merge.preview", targetId }, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context); await authorizeMerge(tx, context);
    await lockClient(tx, targetId, context.studioId, context.userId, false, "CLIENT_READ");
    const { isNull, ne } = await import("drizzle-orm");
    return tx.select({ id: clients.id, fullName: clients.fullName, phone: clients.phone, archivedAt: clients.deletedAt }).from(clients)
      .where(and(eq(clients.studioId, context.studioId), isNull(clients.mergedIntoId), ne(clients.id,targetId))).orderBy(clients.fullName,clients.id);
  }), recordIds);
}
