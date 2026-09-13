import "server-only";
import { db } from "@/db";
import { accessLogs } from "@/db/schema";
import { requireStudioContext } from "@/server/auth/context";
import { hasPermission, type PermissionCode } from "@/lib/permissions";
import { ACCESS_OPERATIONS } from "@/lib/audit-contract";
import { z } from "zod";

const descriptorSchema = z.object({ operation: z.enum(ACCESS_OPERATIONS), targetId: z.string().uuid().optional() }).strict();
export type AccessDescriptor = z.infer<typeof descriptorSchema>;
type Context = { studioId: string; userId: string };
// This is an application-read log, not proof that someone opened/downloaded a file.
// Unauthenticated/cross-tenant callers get no record in an unverified tenant.
export async function sensitiveRead<T>(permission: PermissionCode | null, requestedStudioId: string | undefined,
  descriptor: AccessDescriptor, read: (context: Context) => Promise<T>, ids: (result: T) => string[]): Promise<T> {
  const context = await requireStudioContext(requestedStudioId);
  const target = descriptorSchema.parse(descriptor);
  async function log(result: "returned" | "not_returned" | "denied" | "error", recordIds: string[] = []) {
    try {
      const safeIds = z.array(z.string().uuid()).parse(recordIds);
      await db.insert(accessLogs).values({ studioId: context.studioId, actorId: context.userId, operation: target.operation,
        targetId: target.targetId ?? null, result, recordIds: safeIds, recordCount: safeIds.length });
    } catch { throw new Error("Access logging unavailable"); }
  }
  if (permission !== null && !await hasPermission(db, context.userId, context.studioId, permission)) {
    await log("denied");
    throw new Error("Permission denied");
  }
  let result: T;
  try { result = await read(context); }
  catch (error) {
    await log(error instanceof Error && error.message === "Permission denied" ? "denied" : "error");
    throw error;
  }
  const returned = ids(result);
  await log(returned.length ? "returned" : "not_returned", returned);
  return result;
}
export const recordIds = (rows: { id: string }[]) => rows.map(row => row.id);
export const optionalRecordId = (row: { id: string } | null | undefined) => row ? [row.id] : [];
