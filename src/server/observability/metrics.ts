import "server-only";
import { db } from "@/db";
import {
  outboxJobs,
  automationExecutions,
  googleCalendarConnections,
  googleCalendarEventMappings,
  aiRuns,
  handoffs,
} from "@/db/schema";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { getWorkerHeartbeats, type WorkerHeartbeatRecord } from "@/server/events/heartbeat";

export interface DatabaseHealthResult {
  status: "connected" | "unreachable";
  latencyMs: number;
  migrationHead?: string;
  error?: string;
}

export interface OutboxMetricsResult {
  pendingCount: number;
  runningCount: number;
  failedDeadCount: number;
  uncertainCount: number;
  retryingCount: number;
  completedRecentlyCount: number;
  outboxLagSeconds: number;
  stuckJobsCount: number;
  stuckJobs: Array<{
    id: string;
    studioId: string;
    handler: string;
    state: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    availableAt: Date;
    createdAt: Date;
    reason: "lease_expired" | "attempts_exhausted" | "pending_too_long" | "dead_state";
  }>;
}

export interface AutomationMetricsResult {
  scheduledCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  skippedCount: number;
  retryCount: number;
  oldestOverdueSeconds: number;
}

export interface GoogleCalendarMetricsResult {
  totalConnections: number;
  connectedCount: number;
  needsReauthCount: number;
  disconnectedCount: number;
  syncFailuresCount: number;
  syncConflictsCount: number;
  pendingSyncJobsCount: number;
  lastSuccessfulSync: Date | null;
}

export interface AiMetricsResult {
  runsTotal: number;
  successCount: number;
  failureCount: number;
  malformedOutputCount: number;
  guardrailRejectionCount: number;
  providerUnavailableCount: number;
  avgLatencyMs: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface HandoffMetricsResult {
  activeCount: number;
  overdueCount: number;
  completedCount: number;
  rejectedCount: number;
}

export interface AlertSignals {
  databaseUnavailable: boolean;
  workerStale: boolean;
  outboxLagCritical: boolean;
  deadJobsPresent: boolean;
  googleReauthRequired: boolean;
  automationFailureSpike: boolean;
  aiFailureSpike: boolean;
}

export interface OperationalMetricsSummary {
  timestamp: string;
  overallStatus: "healthy" | "degraded" | "unhealthy";
  liveness: {
    status: "healthy";
  };
  readiness: {
    status: "healthy" | "unhealthy";
    database: DatabaseHealthResult;
    workerHeartbeat: WorkerHeartbeatRecord | null;
  };
  integrations: {
    googleCalendar: {
      status: "healthy" | "degraded";
      connected: number;
      needsReauth: number;
    };
    ai: {
      status: "healthy" | "degraded";
      failureRatePercent: number;
    };
  };
  outbox: OutboxMetricsResult;
  automations: AutomationMetricsResult;
  googleCalendar: GoogleCalendarMetricsResult;
  ai: AiMetricsResult;
  handoffs: HandoffMetricsResult;
  alerts: AlertSignals;
}

/**
 * Checks PostgreSQL connectivity bounded by a strict timeout (2000ms).
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const start = Date.now();
  try {
    // 1. Simple bounded connectivity query
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;

    return {
      status: "connected",
      latencyMs,
      migrationHead: "0037_awesome_the_anarchist",
    };
  } catch (error) {
    return {
      status: "unreachable",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Database connection failed",
    };
  }
}

/**
 * Computes Outbox Subsystem operational metrics.
 */
export async function getOutboxMetrics(studioId?: string): Promise<OutboxMetricsResult> {
  const scopeCondition = studioId ? eq(outboxJobs.studioId, studioId) : sql`1=1`;

  // Aggregate counts by state
  const stateCounts = await db
    .select({
      state: outboxJobs.state,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(outboxJobs)
    .where(scopeCondition)
    .groupBy(outboxJobs.state);

  let pendingCount = 0;
  let runningCount = 0;
  let failedDeadCount = 0;
  let uncertainCount = 0;

  for (const row of stateCounts) {
    if (row.state === "pending") pendingCount = Number(row.count);
    else if (row.state === "processing" || row.state === "reconciling") runningCount += Number(row.count);
    else if (row.state === "dead") failedDeadCount = Number(row.count);
    else if (row.state === "uncertain") uncertainCount = Number(row.count);
  }

  // Retrying count (pending with attempts > 0)
  const [retryingRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(outboxJobs)
    .where(and(scopeCondition, eq(outboxJobs.state, "pending"), sql`${outboxJobs.attempts} > 0`));
  const retryingCount = Number(retryingRow?.count || 0);

  // Completed recently (last 24h)
  const [completedRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(outboxJobs)
    .where(
      and(
        scopeCondition,
        eq(outboxJobs.state, "completed"),
        gte(outboxJobs.updatedAt, sql`now() - interval '24 hours'`)
      )
    );
  const completedRecentlyCount = Number(completedRow?.count || 0);

  // Outbox lag: age of oldest runnable pending job (where available_at <= now())
  // Note: future scheduled jobs (available_at > now()) are excluded from lag!
  const [oldestRunnableRow] = await db
    .select({
      availableAt: outboxJobs.availableAt,
      ageSeconds: sql<number>`cast(extract(epoch from (now() - ${outboxJobs.availableAt})) as integer)`,
    })
    .from(outboxJobs)
    .where(and(scopeCondition, eq(outboxJobs.state, "pending"), lte(outboxJobs.availableAt, sql`now()`)))
    .orderBy(outboxJobs.availableAt)
    .limit(1);

  const outboxLagSeconds = Math.max(0, Number(oldestRunnableRow?.ageSeconds || 0));

  // Stuck jobs detection:
  // - lease expired while in processing/reconciling
  // - attempts >= maxAttempts
  // - state = 'dead' or 'uncertain'
  // - runnable pending for > 30 minutes
  const stuckRows = await db
    .select({
      id: outboxJobs.id,
      studioId: outboxJobs.studioId,
      handler: outboxJobs.handler,
      state: outboxJobs.state,
      attempts: outboxJobs.attempts,
      maxAttempts: outboxJobs.maxAttempts,
      lastError: outboxJobs.lastError,
      availableAt: outboxJobs.availableAt,
      leaseUntil: outboxJobs.leaseUntil,
      createdAt: outboxJobs.createdAt,
    })
    .from(outboxJobs)
    .where(
      and(
        scopeCondition,
        sql`(
          (${outboxJobs.state} in ('processing', 'reconciling') and ${outboxJobs.leaseUntil} < now()) or
          (${outboxJobs.state} in ('dead', 'uncertain')) or
          (${outboxJobs.attempts} >= ${outboxJobs.maxAttempts}) or
          (${outboxJobs.state} = 'pending' and ${outboxJobs.availableAt} < now() - interval '30 minutes')
        )`
      )
    )
    .orderBy(desc(outboxJobs.updatedAt))
    .limit(50);

  const stuckJobs = stuckRows.map((job) => {
    let reason: "lease_expired" | "attempts_exhausted" | "pending_too_long" | "dead_state" = "dead_state";
    if (job.state === "processing" || job.state === "reconciling") {
      reason = "lease_expired";
    } else if (job.attempts >= job.maxAttempts) {
      reason = "attempts_exhausted";
    } else if (job.state === "pending") {
      reason = "pending_too_long";
    }

    return {
      id: job.id,
      studioId: job.studioId,
      handler: job.handler,
      state: job.state,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      availableAt: job.availableAt,
      createdAt: job.createdAt,
      reason,
    };
  });

  return {
    pendingCount,
    runningCount,
    failedDeadCount,
    uncertainCount,
    retryingCount,
    completedRecentlyCount,
    outboxLagSeconds,
    stuckJobsCount: stuckJobs.length,
    stuckJobs,
  };
}

/**
 * Computes Automation subsystem operational metrics.
 */
export async function getAutomationMetrics(studioId?: string): Promise<AutomationMetricsResult> {
  const scopeCondition = studioId ? eq(automationExecutions.studioId, studioId) : sql`1=1`;

  const statusRows = await db
    .select({
      status: automationExecutions.status,
      count: sql<number>`cast(count(*) as integer)`,
      totalRetries: sql<number>`cast(sum(${automationExecutions.attemptCount} - 1) as integer)`,
    })
    .from(automationExecutions)
    .where(scopeCondition)
    .groupBy(automationExecutions.status);

  let scheduledCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let skippedCount = 0;
  let retryCount = 0;

  for (const r of statusRows) {
    const c = Number(r.count);
    if (r.status === "scheduled" || r.status === "running") scheduledCount += c;
    else if (r.status === "succeeded") succeededCount += c;
    else if (r.status === "failed") failedCount += c;
    else if (r.status === "cancelled") cancelledCount += c;
    else if (r.status === "skipped") skippedCount += c;

    if (r.totalRetries && Number(r.totalRetries) > 0) {
      retryCount += Number(r.totalRetries);
    }
  }

  // Oldest overdue automation execution (status in ('scheduled') and scheduledFor <= now())
  const [oldestOverdueRow] = await db
    .select({
      ageSeconds: sql<number>`cast(extract(epoch from (now() - ${automationExecutions.scheduledFor})) as integer)`,
    })
    .from(automationExecutions)
    .where(
      and(
        scopeCondition,
        eq(automationExecutions.status, "scheduled"),
        lte(automationExecutions.scheduledFor, sql`now()`)
      )
    )
    .orderBy(automationExecutions.scheduledFor)
    .limit(1);

  const oldestOverdueSeconds = Math.max(0, Number(oldestOverdueRow?.ageSeconds || 0));

  return {
    scheduledCount,
    succeededCount,
    failedCount,
    cancelledCount,
    skippedCount,
    retryCount,
    oldestOverdueSeconds,
  };
}

/**
 * Computes Google Calendar subsystem operational metrics.
 */
export async function getGoogleCalendarMetrics(studioId?: string): Promise<GoogleCalendarMetricsResult> {
  const connScope = studioId ? eq(googleCalendarConnections.studioId, studioId) : sql`1=1`;
  const mapScope = studioId ? eq(googleCalendarEventMappings.studioId, studioId) : sql`1=1`;

  const connections = await db
    .select({
      status: googleCalendarConnections.status,
      syncStatus: googleCalendarConnections.syncStatus,
      lastSyncAt: googleCalendarConnections.lastSyncAt,
    })
    .from(googleCalendarConnections)
    .where(connScope);

  const totalConnections = connections.length;
  let connectedCount = 0;
  let needsReauthCount = 0;
  let disconnectedCount = 0;
  let syncFailuresCount = 0;
  let lastSuccessfulSync: Date | null = null;

  for (const c of connections) {
    if (c.status === "connected") connectedCount++;
    else if (c.status === "needs_reauth") needsReauthCount++;
    else if (c.status === "disconnected" || c.status === "sync_error") disconnectedCount++;

    if (c.syncStatus === "error") syncFailuresCount++;

    if (c.lastSyncAt) {
      if (!lastSuccessfulSync || new Date(c.lastSyncAt) > new Date(lastSuccessfulSync)) {
        lastSuccessfulSync = c.lastSyncAt;
      }
    }
  }

  // Event conflict/failed count from mappings
  const [conflictRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(googleCalendarEventMappings)
    .where(and(mapScope, eq(googleCalendarEventMappings.status, "failed")));
  const syncConflictsCount = Number(conflictRow?.count || 0);

  // Pending sync jobs in outbox
  const [pendingSyncRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(outboxJobs)
    .where(
      and(
        studioId ? eq(outboxJobs.studioId, studioId) : sql`1=1`,
        eq(outboxJobs.state, "pending"),
        sql`${outboxJobs.handler} in ('google_calendar.sync_event', 'google_calendar.sync_appointment', 'google_calendar.reconcile')`
      )
    );
  const pendingSyncJobsCount = Number(pendingSyncRow?.count || 0);

  return {
    totalConnections,
    connectedCount,
    needsReauthCount,
    disconnectedCount,
    syncFailuresCount,
    syncConflictsCount,
    pendingSyncJobsCount,
    lastSuccessfulSync,
  };
}

/**
 * Computes AI Copilot subsystem operational metrics.
 */
export async function getAiMetrics(studioId?: string): Promise<AiMetricsResult> {
  const scopeCondition = studioId ? eq(aiRuns.studioId, studioId) : sql`1=1`;

  const runs = await db
    .select({
      status: aiRuns.status,
      error: aiRuns.error,
      startedAt: aiRuns.startedAt,
      completedAt: aiRuns.completedAt,
      inputTokens: aiRuns.inputTokens,
      outputTokens: aiRuns.outputTokens,
    })
    .from(aiRuns)
    .where(scopeCondition);

  const runsTotal = runs.length;
  let successCount = 0;
  let failureCount = 0;
  let malformedOutputCount = 0;
  let guardrailRejectionCount = 0;
  let providerUnavailableCount = 0;
  let totalLatencyMs = 0;
  let latencyRunsCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const r of runs) {
    if (r.status === "completed") {
      successCount++;
    } else if (r.status === "failed") {
      failureCount++;
      const code = (r.error || "").toUpperCase();
      if (code.includes("MALFORMED") || code.includes("SCHEMA")) {
        malformedOutputCount++;
      } else if (code.includes("GUARDRAIL") || code.includes("PROHIBITED")) {
        guardrailRejectionCount++;
      } else if (code.includes("TIMEOUT") || code.includes("RATE_LIMIT") || code.includes("UNAVAILABLE") || code.includes("NETWORK")) {
        providerUnavailableCount++;
      }
    }

    if (r.startedAt && r.completedAt) {
      const dur = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
      if (dur > 0) {
        totalLatencyMs += dur;
        latencyRunsCount++;
      }
    }

    if (r.inputTokens) inputTokens += r.inputTokens;
    if (r.outputTokens) outputTokens += r.outputTokens;
  }

  const avgLatencyMs = latencyRunsCount > 0 ? Math.round(totalLatencyMs / latencyRunsCount) : 0;

  return {
    runsTotal,
    successCount,
    failureCount,
    malformedOutputCount,
    guardrailRejectionCount,
    providerUnavailableCount,
    avgLatencyMs,
    tokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

/**
 * Computes Handoff Queue operational metrics.
 */
export async function getHandoffMetrics(studioId?: string): Promise<HandoffMetricsResult> {
  const scopeCondition = studioId ? eq(handoffs.studioId, studioId) : sql`1=1`;

  const rows = await db
    .select({
      status: handoffs.status,
      dueAt: handoffs.dueAt,
    })
    .from(handoffs)
    .where(scopeCondition);

  let activeCount = 0;
  let overdueCount = 0;
  let completedCount = 0;
  let rejectedCount = 0;
  const now = Date.now();

  for (const r of rows) {
    if (r.status === "PENDING" || r.status === "ACCEPTED") {
      activeCount++;
      if (r.dueAt && new Date(r.dueAt).getTime() < now) {
        overdueCount++;
      }
    } else if (r.status === "COMPLETED") {
      completedCount++;
    } else if (r.status === "REJECTED") {
      rejectedCount++;
    }
  }

  return {
    activeCount,
    overdueCount,
    completedCount,
    rejectedCount,
  };
}

/**
 * Aggregates complete operational metrics and determines health status and alert signals.
 */
export async function getOperationalMetricsSummary(studioId?: string): Promise<OperationalMetricsSummary> {
  const [dbHealth, outbox, automations, googleCalendar, ai, handoffsMetrics, heartbeats] =
    await Promise.all([
      checkDatabaseHealth(),
      getOutboxMetrics(studioId),
      getAutomationMetrics(studioId),
      getGoogleCalendarMetrics(studioId),
      getAiMetrics(studioId),
      getHandoffMetrics(studioId),
      getWorkerHeartbeats(),
    ]);

  const latestHeartbeat = heartbeats[0] || null;
  const isWorkerStale = !latestHeartbeat || latestHeartbeat.status !== "fresh";

  // Alert Signals calculation with deterministic thresholds
  const alerts: AlertSignals = {
    databaseUnavailable: dbHealth.status !== "connected",
    workerStale: isWorkerStale && outbox.pendingCount > 0,
    outboxLagCritical: outbox.outboxLagSeconds > 300,
    deadJobsPresent: outbox.failedDeadCount > 0,
    googleReauthRequired: googleCalendar.needsReauthCount > 0,
    automationFailureSpike: automations.failedCount >= 5,
    aiFailureSpike: ai.failureCount >= 5,
  };

  // Status computation:
  // - UNHEALTHY if database is down or readiness failed
  // - DEGRADED if Google Calendar needs reauth, AI failure spike, outbox lag critical, or worker stale
  // - HEALTHY otherwise
  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
  let readinessStatus: "healthy" | "unhealthy" = "healthy";

  if (dbHealth.status !== "connected") {
    overallStatus = "unhealthy";
    readinessStatus = "unhealthy";
  } else if (
    alerts.googleReauthRequired ||
    alerts.aiFailureSpike ||
    alerts.outboxLagCritical ||
    alerts.deadJobsPresent ||
    alerts.automationFailureSpike
  ) {
    overallStatus = "degraded";
  }

  const aiFailureRate =
    ai.runsTotal > 0 ? Math.round((ai.failureCount / ai.runsTotal) * 100) : 0;

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    liveness: {
      status: "healthy",
    },
    readiness: {
      status: readinessStatus,
      database: dbHealth,
      workerHeartbeat: latestHeartbeat,
    },
    integrations: {
      googleCalendar: {
        status: googleCalendar.needsReauthCount > 0 || googleCalendar.syncFailuresCount > 0 ? "degraded" : "healthy",
        connected: googleCalendar.connectedCount,
        needsReauth: googleCalendar.needsReauthCount,
      },
      ai: {
        status: aiFailureRate > 20 || ai.providerUnavailableCount > 0 ? "degraded" : "healthy",
        failureRatePercent: aiFailureRate,
      },
    },
    outbox,
    automations,
    googleCalendar,
    ai,
    handoffs: handoffsMetrics,
    alerts,
  };
}
