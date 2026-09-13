import "server-only";
import { db } from "@/db";
import { auditLogs, accessLogs } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { resourceScope } from "@/server/auth/scopes";
import { sensitiveRead, recordIds } from "@/server/services/access-log.service";
import { z } from "zod";

// Snapshots may contain medical facts. A broad settings grant is insufficient.
export async function getJournal(studioId: string, kind: "audit" | "access", page = 1) {
  const validKind = z.enum(["audit", "access"]).parse(kind);
  const validPage = z.number().int().min(1).max(10000).parse(page);
  return sensitiveRead(null, studioId, { operation: validKind === "audit" ? "audit.list" : "access.list" }, async context => {
    const scope = await resourceScope(context);
    if (scope.role !== "OWNER") throw new Error("Permission denied");
    const table = validKind === "audit" ? auditLogs : accessLogs;
    return db.select().from(table).where(and(scope.currentActor, eq(table.studioId, studioId)))
        .orderBy(desc(table.createdAt), desc(table.id)).limit(50).offset((validPage - 1) * 50);
  }, recordIds);
}
