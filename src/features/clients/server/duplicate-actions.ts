"use server";
import { db } from "@/db";
import { lockStudioAccess } from "@/server/auth/scopes";
import { lockClient, entityId } from "@/server/commands/ownership";
import { sensitiveRead } from "@/server/services/access-log.service";
import { hasPermission } from "@/lib/permissions";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { findDuplicates } from "./deduplication";
export async function reviewClientDuplicates(input: ClientSchema, excludeId?: string) {
  const data = clientSchema.parse(input); if (excludeId) entityId.parse(excludeId);
  return sensitiveRead("CLIENT_READ", undefined, { operation: "clients.duplicates", ...(excludeId ? { targetId: excludeId } : {}) }, context => db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, "CLIENT_READ")) throw new Error("Permission denied");
    if (excludeId) await lockClient(tx, excludeId, context.studioId, context.userId, false, "CLIENT_READ");
    return findDuplicates(tx, context, data, excludeId);
  }), result => result.candidates.map(row => row.id));
}
