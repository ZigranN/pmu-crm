import "server-only";
import { auditLogs } from "@/db/schema";
import { AUDIT_ENTITIES, type AuditAction } from "@/lib/audit-contract";
import type { Transaction } from "@/server/commands/ownership";
import { z } from "zod";
import { sql } from "drizzle-orm";

const values = z.record(z.string(), z.unknown()).nullable();
const contract = z.object({ studioId: z.string().uuid(), userId: z.string().min(1), action: z.string(),
  entityType: z.string(), entityId: z.string().min(1), before: values, after: values,
  reason: z.string().trim().min(1).max(1000), reasonSource: z.enum(["user", "command"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export interface AuditInput {
  studioId: string; userId: string; action: AuditAction; entityType: typeof AUDIT_ENTITIES[AuditAction]; entityId: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  reason: string; reasonSource?: "user" | "command"; metadata?: Record<string, unknown>;
}
// JSON snapshots freeze Dates/objects at execution time, rather than retaining references.
export function snapshot(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
export async function writeAudit(tx: Transaction, input: AuditInput) {
  const data = contract.parse({ ...input, reasonSource: input.reasonSource ?? "command" });
  if (!Object.hasOwn(AUDIT_ENTITIES, data.action) || AUDIT_ENTITIES[data.action as AuditAction] !== data.entityType) throw new Error("Invalid audit event contract");
  await tx.insert(auditLogs).values({ studioId: data.studioId, userId: data.userId, action: data.action as AuditAction,
    entityType: data.entityType, entityId: data.entityId, contractVersion: 1,
    oldValues: data.before === null ? sql`'null'::jsonb` : snapshot(data.before),
    newValues: data.after === null ? sql`'null'::jsonb` : snapshot(data.after),
    reason: data.reason, reasonSource: data.reasonSource, metadata: data.metadata ? snapshot(data.metadata) : {},
  });
}
