export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  studioId?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  commandId?: string;
  jobId?: string;
  executionId?: string;
  feature?: string;
  errorCode?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface StructuredLogEntry extends LogContext {
  level: LogLevel;
  timestamp: string;
  message: string;
}

const REDACTED_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "encryptedaccesstoken",
  "encryptedrefreshtoken",
  "clientsecret",
  "apikey",
  "password",
  "token",
  "secret",
  "authorization",
  "signature",
  "signaturedataurl",
  "consentsignature",
  "medicalform",
  "cardnumber",
  "cvv",
  "pan",
  "privatekey",
]);

const SENSITIVE_PATTERN = /bearer\s+[a-zA-Z0-9_\-\.]+/gi;

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.replace(SENSITIVE_PATTERN, "Bearer [REDACTED]");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.NODE_ENV === "development" ? value.stack : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase().replace(/[^a-z]/g, "");
      if (REDACTED_KEYS.has(lower) || lower.includes("secret") || lower.includes("password") || lower.includes("token")) {
        clean[k] = "[REDACTED]";
      } else {
        clean[k] = sanitizeValue(v, depth + 1);
      }
    }
    return clean;
  }

  return String(value);
}

class StructuredLogger {
  private baseContext: LogContext = {};

  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext;
  }

  public withContext(context: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.baseContext, ...context });
  }

  public log(level: LogLevel, message: string, context?: LogContext): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(sanitizeValue({ ...this.baseContext, ...context }) as LogContext),
    };

    const formatted = JSON.stringify(entry);
    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else if (level === "info") {
      console.info(formatted);
    } else {
      console.debug(formatted);
    }

    return entry;
  }

  public debug(message: string, context?: LogContext): StructuredLogEntry {
    return this.log("debug", message, context);
  }

  public info(message: string, context?: LogContext): StructuredLogEntry {
    return this.log("info", message, context);
  }

  public warn(message: string, context?: LogContext): StructuredLogEntry {
    return this.log("warn", message, context);
  }

  public error(message: string, context?: LogContext): StructuredLogEntry {
    return this.log("error", message, context);
  }
}

export const logger = new StructuredLogger();
export { StructuredLogger };
