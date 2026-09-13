import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { commandReceipts } from "@/db/schema";
import { lockStudioAccess } from "@/server/auth/scopes";
import { hasPermission, type PermissionCode } from "@/lib/permissions";
import type { Transaction } from "./ownership";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
export const payloadHash = (value: Json) => createHash("sha256").update(canonicalJson(value)).digest("hex");
// Internal server API: context is resolved by the action, never taken from its input.
// The callback must contain DB work only. External effects are transactional outbox jobs.
export async function idempotentCommand<T extends Json>(context: { studioId: string; userId: string },
  permission: PermissionCode, command: string, requestKey: string, payload: Json,
  execute: (tx: Transaction, commandId: string) => Promise<T>,
  validateReplay: (tx: Transaction, result: T) => Promise<void>): Promise<T> {
  z.string().uuid().parse(requestKey);
  z.string().min(1).max(100).parse(command);
  const hash = payloadHash(payload);
  return db.transaction(async tx => {
    // Same studio lock as membership/domain changes, including concurrent first requests.
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, permission)) throw new Error("Permission denied");
    const key = and(eq(commandReceipts.studioId, context.studioId), eq(commandReceipts.actorId, context.userId),
      eq(commandReceipts.command, command), eq(commandReceipts.requestKey, requestKey));
    const [receipt] = await tx.select().from(commandReceipts).where(key);
    if (receipt) {
      if (receipt.payloadHash !== hash) throw new Error("Ключ запроса уже использован с другими данными");
      const result = receipt.result as T;
      await validateReplay(tx, result);
      return result;
    }
    const id = randomUUID();
    const result = await execute(tx, id);
    await tx.insert(commandReceipts).values({ id, studioId: context.studioId, actorId: context.userId,
      command, requestKey, payloadHash: hash, result: result === null ? sql`'null'::jsonb` : result });
    return result;
  });
}
