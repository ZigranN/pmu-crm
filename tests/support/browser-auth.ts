import type { APIRequestContext } from "@playwright/test";
import { setTimeout } from "node:timers/promises";

// Fixture signups share a localhost IP. Honor the real auth limiter instead of
// disabling it or changing client identity; 429 guarantees this signup was rejected.
export async function registerTestUser(request: APIRequestContext, options: Parameters<APIRequestContext["post"]>[1]) {
  const response = await request.post("/api/auth/sign-up/email", options);
  if (response.status() !== 429) return response;
  const headers = response.headers();
  const delay = Number(headers["retry-after"] ?? headers["x-retry-after"] ?? "NaN");
  if (!Number.isFinite(delay) || delay < 0 || delay > 60) throw new Error("Unexpected signup retry interval");
  await response.dispose();
  await setTimeout(Math.max(1, delay) * 1000 + 100);
  return request.post("/api/auth/sign-up/email", options);
}
