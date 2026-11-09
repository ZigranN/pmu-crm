export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class AiRateLimiter {
  private requestLog = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(options: RateLimiterOptions = { windowMs: 60000, maxRequests: 30 }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  checkRateLimit(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const timestamps = this.requestLog.get(key) || [];
    
    // Filter out timestamps outside window
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);
    
    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const resetInMs = Math.max(0, this.windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetInMs,
      };
    }

    validTimestamps.push(now);
    this.requestLog.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetInMs: this.windowMs,
    };
  }

  reset(key?: string) {
    if (key) {
      this.requestLog.delete(key);
    } else {
      this.requestLog.clear();
    }
  }
}

export const globalAiRateLimiter = new AiRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 20, // 20 requests per minute per user/studio
});

export async function withBoundedRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 100;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      // Only retry transient 5xx errors or network glitches, never retry 422 malformed schema or deterministic guardrails
      const isTransient =
        err?.status === 500 ||
        err?.status === 502 ||
        err?.status === 503 ||
        err?.status === 504 ||
        err?.code === "AI_NETWORK_ERROR";

      if (!isTransient || attempt > maxRetries) {
        throw err;
      }

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Bounded retry exhausted without result");
}
