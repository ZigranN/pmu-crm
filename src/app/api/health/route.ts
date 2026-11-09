import { NextResponse } from "next/server";
import {
  checkDatabaseHealth,
  getOutboxMetrics,
  getGoogleCalendarMetrics,
  getAiMetrics,
} from "@/server/observability/metrics";
import { getWorkerHeartbeats } from "@/server/events/heartbeat";
import { extractCorrelationId } from "@/lib/observability/correlation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = extractCorrelationId(request.headers);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  const timestamp = new Date().toISOString();

  // 1. Liveness check: process is responsive
  if (mode === "liveness") {
    return NextResponse.json(
      {
        status: "healthy",
        mode: "liveness",
        timestamp,
        app: "crm-pmu",
      },
      {
        status: 200,
        headers: { "x-request-id": requestId },
      }
    );
  }

  // 2. Database Health & Readiness check
  const [dbHealth, heartbeats] = await Promise.all([
    checkDatabaseHealth(),
    getWorkerHeartbeats(),
  ]);

  const latestHeartbeat = heartbeats[0] || null;
  const isDbHealthy = dbHealth.status === "connected";

  if (mode === "readiness") {
    const isReady = isDbHealthy;
    return NextResponse.json(
      {
        status: isReady ? "healthy" : "unhealthy",
        mode: "readiness",
        timestamp,
        app: "crm-pmu",
        database: {
          status: dbHealth.status,
          latencyMs: dbHealth.latencyMs,
          migrationHead: dbHealth.migrationHead || null,
        },
        worker: latestHeartbeat
          ? {
              status: latestHeartbeat.status,
              ageSeconds: latestHeartbeat.ageSeconds,
            }
          : { status: "idle", ageSeconds: null },
      },
      {
        status: isReady ? 200 : 503,
        headers: { "x-request-id": requestId },
      }
    );
  }

  // 3. Full Health endpoint
  const [outbox, googleCalendar, ai] = await Promise.all([
    getOutboxMetrics(),
    getGoogleCalendarMetrics(),
    getAiMetrics(),
  ]);

  const googleDegraded =
    googleCalendar.needsReauthCount > 0 || googleCalendar.syncFailuresCount > 0;
  const aiDegraded =
    ai.providerUnavailableCount > 0 ||
    (ai.runsTotal > 0 && ai.failureCount / ai.runsTotal > 0.2);

  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (!isDbHealthy) {
    overallStatus = "unhealthy";
  } else if (googleDegraded || aiDegraded || outbox.outboxLagSeconds > 300 || outbox.failedDeadCount > 0) {
    overallStatus = "degraded";
  }

  const responseBody = {
    status: overallStatus,
    timestamp,
    app: "crm-pmu",
    liveness: {
      status: "healthy",
    },
    readiness: {
      status: isDbHealthy ? "healthy" : "unhealthy",
      database: {
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
        migrationHead: dbHealth.migrationHead || null,
      },
      worker: latestHeartbeat
        ? {
            status: latestHeartbeat.status,
            ageSeconds: latestHeartbeat.ageSeconds,
          }
        : { status: "idle", ageSeconds: null },
    },
    integrations: {
      googleCalendar: {
        status: googleDegraded ? "degraded" : "healthy",
        connected: googleCalendar.connectedCount,
        needsReauth: googleCalendar.needsReauthCount,
      },
      ai: {
        status: aiDegraded ? "degraded" : "healthy",
        failureCount: ai.failureCount,
        runsTotal: ai.runsTotal,
      },
    },
    outbox: {
      pendingCount: outbox.pendingCount,
      lagSeconds: outbox.outboxLagSeconds,
      deadCount: outbox.failedDeadCount,
    },
  };

  return NextResponse.json(responseBody, {
    status: isDbHealthy ? 200 : 503,
    headers: { "x-request-id": requestId },
  });
}
