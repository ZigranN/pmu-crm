import { handlers } from "@/server/events/registry";
import { runWorkerOnce } from "@/server/events/worker";

export interface ProcessAutomationOptions {
  batchSize?: number;
  timeoutMs?: number;
}

export interface ProcessAutomationResult {
  processed: number;
}

/**
 * Worker execution entrypoint for processing automation and background outbox jobs.
 * Drains ready jobs up to batchSize using PostgreSQL FOR UPDATE SKIP LOCKED.
 */
export async function processAutomationJobs(
  options: ProcessAutomationOptions = {}
): Promise<ProcessAutomationResult> {
  const batchSize = Math.min(Math.max(options.batchSize ?? 10, 1), 100);
  const timeoutMs = options.timeoutMs ?? 10000;

  let processed = 0;

  for (let i = 0; i < batchSize; i++) {
    const executed = await runWorkerOnce(handlers, timeoutMs);
    if (!executed) {
      break;
    }
    processed++;
  }

  return { processed };
}
