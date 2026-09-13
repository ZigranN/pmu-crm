import "server-only";
import { db } from "@/db";
import { outboxJobs, jobAttempts } from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { resourceScope } from "@/server/auth/scopes";
import { sensitiveRead, recordIds } from "@/server/services/access-log.service";
import { z } from "zod";
export async function getJobs(studioId: string, page = 1, attention = true) {
  z.number().int().min(1).max(10000).parse(page);
  return sensitiveRead(null, studioId, { operation: "jobs.list" }, async context => {
    const scope = await resourceScope(context);
    if (scope.role !== "OWNER") throw new Error("Permission denied");
    const rows = await db.select({ id: outboxJobs.id, handler: outboxJobs.handler, state: outboxJobs.state, attempts: outboxJobs.attempts,
      lastError: outboxJobs.lastError, availableAt: outboxJobs.availableAt, updatedAt: outboxJobs.updatedAt, externalId: outboxJobs.externalId })
      .from(outboxJobs).where(and(scope.currentActor, eq(outboxJobs.studioId, studioId), attention ? inArray(outboxJobs.state, ["dead", "uncertain"]) : undefined))
      .orderBy(desc(outboxJobs.createdAt), desc(outboxJobs.id)).limit(50).offset((page - 1) * 50);
    // No payload, provider error body or personal facts are returned by this screen.
    const attempts = rows.length ? await db.select({ attempt: jobAttempts }).from(jobAttempts).innerJoin(outboxJobs, eq(jobAttempts.jobId, outboxJobs.id))
      .where(and(scope.currentActor, eq(outboxJobs.studioId, studioId), inArray(jobAttempts.jobId, rows.map(r => r.id))))
      .orderBy(desc(jobAttempts.startedAt)).limit(200) : [];
    return rows.map(row => ({ ...row, history: attempts.filter(a => a.attempt.jobId === row.id).map(a => a.attempt) }));
  }, recordIds);
}
