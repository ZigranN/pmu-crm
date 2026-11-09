import "server-only";
import { sensitiveRead } from "@/server/services/access-log.service";
import {
  getOperationalMetricsSummary,
  checkDatabaseHealth,
  type OperationalMetricsSummary,
} from "@/server/observability/metrics";
import { getWorkerHeartbeats } from "@/server/events/heartbeat";
import { fetchDailyPaymentReportInternal } from "@/features/ledger/server/queries";
import type { DailyPaymentReportSummary } from "@/features/ledger/domain/daily-report";

export interface OperationsDashboardData extends OperationalMetricsSummary {
  studioId: string;
  dailyPaymentReport?: DailyPaymentReportSummary;
}

export async function getOperationsDashboardData(
  targetStudioId?: string
): Promise<OperationsDashboardData> {
  return sensitiveRead(
    "OPERATIONS_READ",
    targetStudioId,
    { operation: "operations.read" },
    async (context) => {
      const [summary, dailyReport] = await Promise.all([
        getOperationalMetricsSummary(context.studioId),
        fetchDailyPaymentReportInternal(context.studioId).catch(() => undefined),
      ]);
      return {
        ...summary,
        studioId: context.studioId,
        dailyPaymentReport: dailyReport,
      };
    },
    () => []
  );
}

export async function getGlobalSystemHealth() {
  const [dbHealth, heartbeats] = await Promise.all([
    checkDatabaseHealth(),
    getWorkerHeartbeats(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    status: dbHealth.status === "connected" ? "healthy" : "unhealthy",
    database: dbHealth,
    worker: heartbeats[0] || null,
  };
}
