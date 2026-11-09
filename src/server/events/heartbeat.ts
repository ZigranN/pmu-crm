import "server-only";
import { db } from "@/db";
import { workerHeartbeats } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { logger } from "@/lib/observability/logger";

export interface WorkerHeartbeatRecord {
  id: string;
  workerName: string;
  instanceId: string;
  lastHeartbeat: Date;
  startedAt: Date;
  version: string;
  status: "fresh" | "stale" | "dead";
  ageSeconds: number;
}

export async function recordWorkerHeartbeat(
  workerName = "outbox-worker",
  instanceId = process.env.HOSTNAME || "worker-default",
  version = "1.0.0",
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .insert(workerHeartbeats)
      .values({
        workerName,
        instanceId,
        version,
        lastHeartbeat: new Date(),
        startedAt: new Date(),
        metadata: metadata || null,
      })
      .onConflictDoUpdate({
        target: [workerHeartbeats.workerName, workerHeartbeats.instanceId],
        set: {
          lastHeartbeat: sql`now()`,
          version,
          metadata: metadata || null,
        },
      });
  } catch (err) {
    logger.warn("Failed to record worker heartbeat", {
      workerName,
      instanceId,
      error: String(err),
    });
  }
}

export async function getWorkerHeartbeats(
  staleThresholdSeconds = 300,
  deadThresholdSeconds = 1800
): Promise<WorkerHeartbeatRecord[]> {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.lastHeartbeat))
    .limit(20);

  const now = Date.now();

  return rows.map((r) => {
    const lastTime = new Date(r.lastHeartbeat).getTime();
    const ageSeconds = Math.max(0, Math.floor((now - lastTime) / 1000));
    let status: "fresh" | "stale" | "dead" = "fresh";
    if (ageSeconds > deadThresholdSeconds) {
      status = "dead";
    } else if (ageSeconds > staleThresholdSeconds) {
      status = "stale";
    }

    return {
      id: r.id,
      workerName: r.workerName,
      instanceId: r.instanceId,
      lastHeartbeat: r.lastHeartbeat,
      startedAt: r.startedAt,
      version: r.version,
      status,
      ageSeconds,
    };
  });
}
