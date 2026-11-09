import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  requestId: string;
  studioId?: string;
  userId?: string;
  commandId?: string;
  feature?: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function getCorrelationId(): string {
  const store = correlationStorage.getStore();
  return store?.requestId || randomUUID();
}

export function withCorrelationContext<T>(
  context: Partial<CorrelationContext>,
  fn: () => T
): T {
  const current: Partial<CorrelationContext> = correlationStorage.getStore() || {};
  const merged: CorrelationContext = {
    requestId: context.requestId || current.requestId || randomUUID(),
    studioId: context.studioId ?? current.studioId,
    userId: context.userId ?? current.userId,
    commandId: context.commandId ?? current.commandId,
    feature: context.feature ?? current.feature,
  };
  return correlationStorage.run(merged, fn);
}

export function extractCorrelationId(headersObj?: Headers | Record<string, string | string[] | undefined> | null): string {
  if (!headersObj) return randomUUID();

  if (typeof (headersObj as Headers).get === "function") {
    const fromHeaders = (headersObj as Headers).get("x-request-id") ||
      (headersObj as Headers).get("x-correlation-id");
    if (fromHeaders && fromHeaders.trim().length > 0) return fromHeaders.trim();
  } else {
    const raw = headersObj as Record<string, string | string[] | undefined>;
    const val = raw["x-request-id"] || raw["x-correlation-id"];
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
    if (Array.isArray(val) && val[0]?.trim()) return val[0].trim();
  }

  return randomUUID();
}
