import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { db } from "@/db";
import { outboxJobs, jobAttempts, studios } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import type { Json } from "@/server/commands/idempotency";
import { consumeOnce } from "./outbox";

export type Job = typeof outboxJobs.$inferSelect;
export class RetryableJobError extends Error {} // Adapter guarantees no external effect occurred.
export class PermanentJobError extends Error {}
export type Handler = {
  kind: "transactional";
  run: (tx: Transaction, job: Job) => Promise<Json>;
} | {
  kind: "external";
  // Must enforce live policy and use job.id as stable provider idempotency/reference key.
  send: (job: Job, signal: AbortSignal) => Promise<{ externalId: string }>;
  // safe_to_retry requires authoritative absence AND no still-running original send.
  reconcile: (job: Job, signal: AbortSignal) => Promise<{ status: "delivered"; externalId: string } | { status: "safe_to_retry" | "unknown" }>;
};
export type Registry = Readonly<Record<string, Handler>>;
const dbNow = sql`now()`;
const activeLease = (job: Job) => and(eq(outboxJobs.id, job.id), eq(outboxJobs.leaseToken, job.leaseToken!),
  sql`${outboxJobs.leaseUntil} > now()`, sql`${outboxJobs.state} in ('processing','reconciling')`);
const nextTime = (attempts: number) => sql`now() + ${Math.min(300, 5 * 2 ** Math.min(attempts, 6))} * interval '1 second'`;

async function claim(registry: Registry): Promise<Job | null> {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(outboxJobs).where(and(
      sql`exists(select 1 from studios where studios.id = ${outboxJobs.studioId} and studios.is_active = true)`,
      sql`((${outboxJobs.state} = 'pending' and ${outboxJobs.availableAt} <= now())
        or (${outboxJobs.state} in ('processing','reconciling') and ${outboxJobs.leaseUntil} <= now())
        or (${outboxJobs.state} = 'uncertain' and ${outboxJobs.attempts} < ${outboxJobs.maxAttempts} and ${outboxJobs.availableAt} <= now()))`,
    )).orderBy(asc(outboxJobs.availableAt), asc(outboxJobs.id)).limit(1).for("update", { skipLocked: true });
    if (!job) return null;
    const handler = Object.hasOwn(registry, job.handler) ? registry[job.handler] : undefined;
    let state = job.state;
    if (state === "processing" || state === "reconciling") {
      await tx.update(jobAttempts).set({ outcome: "expired", errorCode: "lease_expired", finishedAt: dbNow }).where(eq(jobAttempts.id, job.leaseToken!));
      state = job.effectType === "external" || state === "reconciling" ? "uncertain" : "pending";
    }
    const invalidHandler = !handler || handler.kind !== job.effectType || (state === "uncertain" && handler.kind !== "external");
    if (invalidHandler || job.attempts >= job.maxAttempts) {
      await tx.update(outboxJobs).set({ state: state === "uncertain" ? "uncertain" : "dead", leaseToken: null, leaseUntil: null,
        lastError: !handler ? "unknown_handler" : invalidHandler ? "handler_kind_mismatch" : "attempts_exhausted",
        attempts: invalidHandler ? job.maxAttempts : job.attempts, updatedAt: dbNow }).where(eq(outboxJobs.id, job.id));
      return null;
    }
    const token = randomUUID(), mode = state === "uncertain" ? "reconciling" : "processing";
    const [claimed] = await tx.update(outboxJobs).set({ state: mode, attempts: job.attempts + 1, leaseToken: token,
      leaseUntil: sql`now() + interval '60 seconds'`, updatedAt: dbNow }).where(eq(outboxJobs.id, job.id)).returning();
    await tx.insert(jobAttempts).values({ id: token, jobId: job.id, mode });
    return claimed;
  });
}
async function finish(tx: Transaction, job: Job, state: string, errorCode: string | null, externalId?: string) {
  const [updated] = await tx.update(outboxJobs).set({ state, leaseToken: null, leaseUntil: null, lastError: errorCode,
    availableAt: nextTime(job.attempts), updatedAt: dbNow, ...(externalId ? { externalId } : {}) }).where(activeLease(job)).returning();
  if (!updated) return false;
  await tx.update(jobAttempts).set({ outcome: state, errorCode, finishedAt: dbNow }).where(eq(jobAttempts.id, job.leaseToken!));
  return true;
}
async function bounded<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([fn(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("provider_timeout")); }, timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
// Called by a protected scheduler, never an unauthenticated user action.
export async function runWorkerOnce(registry: Registry, timeoutMs = 10000): Promise<boolean> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error("Invalid worker timeout");
  const job = await claim(registry);
  if (!job) return false;
  const handler = registry[job.handler];
  try {
    if (handler.kind === "transactional") {
      await db.transaction(async tx => {
        // Lock order matches human commands/recovery: studio, then job.
        const [studio] = await tx.select().from(studios).where(and(eq(studios.id, job.studioId), eq(studios.isActive, true))).for("update");
        if (!studio) throw new RetryableJobError();
        const [current] = await tx.select().from(outboxJobs).where(activeLease(job)).for("update");
        if (!current) return;
        await consumeOnce(tx, job.studioId, job.handler, job.eventKey, job.payload as Json, () => handler.run(tx, job));
        // Holding the row lock fences other workers, even if the handler crosses its lease deadline.
        await tx.update(outboxJobs).set({ state: "completed", leaseToken: null, leaseUntil: null, lastError: null, updatedAt: dbNow }).where(eq(outboxJobs.id, job.id));
        await tx.update(jobAttempts).set({ outcome: "completed", finishedAt: dbNow }).where(eq(jobAttempts.id, job.leaseToken!));
      });
    } else if (job.state === "reconciling") {
      const result = await bounded(signal => handler.reconcile(job, signal), timeoutMs);
      if (result.status === "delivered") z.string().min(1).max(512).parse(result.externalId);
      await db.transaction(tx => finish(tx, job, result.status === "delivered" ? "completed" : result.status === "safe_to_retry" ? "pending" : "uncertain",
        result.status === "unknown" ? "delivery_unknown" : null, result.status === "delivered" ? result.externalId : undefined));
    } else {
      const [current] = await db.select({ id: outboxJobs.id }).from(outboxJobs).where(and(activeLease(job),
        sql`exists(select 1 from studios where studios.id = ${outboxJobs.studioId} and studios.is_active = true)`));
      if (!current) return true;
      const result = await bounded(signal => handler.send(job, signal), timeoutMs);
      z.string().min(1).max(512).parse(result.externalId);
      await db.transaction(tx => finish(tx, job, "completed", null, result.externalId));
    }
  } catch (error) {
    const uncertain = handler.kind === "external" && (job.state === "reconciling" || !(error instanceof RetryableJobError || error instanceof PermanentJobError));
    const state = uncertain ? "uncertain" : error instanceof PermanentJobError || job.attempts >= job.maxAttempts ? "dead" : "pending";
    // Store codes, never provider error text, payload or credentials.
    await db.transaction(tx => finish(tx, job, state, uncertain ? "delivery_unknown" : error instanceof PermanentJobError ? "permanent_failure" : "handler_failure"));
  }
  return true;
}
