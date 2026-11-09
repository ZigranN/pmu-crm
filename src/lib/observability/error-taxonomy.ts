export const ERROR_CATEGORIES = {
  VALIDATION: "VALIDATION",
  AUTHORIZATION: "AUTHORIZATION",
  TENANT_SCOPE: "TENANT_SCOPE",
  CONFLICT: "CONFLICT",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  RETRYABLE_EXTERNAL: "RETRYABLE_EXTERNAL",
  PERMANENT_EXTERNAL: "PERMANENT_EXTERNAL",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCategory = keyof typeof ERROR_CATEGORIES;

export interface CategorizedError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  safeDetails?: Record<string, unknown>;
}

export function categorizeError(error: unknown): CategorizedError {
  if (!error) {
    return {
      category: ERROR_CATEGORIES.INTERNAL,
      code: "UNKNOWN_ERROR",
      message: "An unknown error occurred",
      retryable: false,
    };
  }

  const err = error as Record<string, unknown>;
  const name = String(err.name || "");
  const msg = String(err.message || "");
  const code = String(err.code || "");

  // 1. Validation Errors
  if (
    name === "ZodError" ||
    name === "ValidationError" ||
    name === "AiGuardrailViolationError" ||
    name === "AiMalformedOutputError" ||
    msg.toLowerCase().includes("validation failed") ||
    msg.toLowerCase().includes("invalid input")
  ) {
    return {
      category: ERROR_CATEGORIES.VALIDATION,
      code: code || "VALIDATION_FAILED",
      message: msg || "Validation error",
      retryable: false,
    };
  }

  // 2. Tenant Scope Errors
  if (
    name === "StudioScopeError" ||
    msg.toLowerCase().includes("tenant isolation") ||
    msg.toLowerCase().includes("cross-studio") ||
    msg.toLowerCase().includes("studio mismatch") ||
    msg.toLowerCase().includes("different studio")
  ) {
    return {
      category: ERROR_CATEGORIES.TENANT_SCOPE,
      code: code || "TENANT_SCOPE_VIOLATION",
      message: "Access restricted to tenant scope",
      retryable: false,
    };
  }

  // 3. Authorization Errors
  if (
    name === "AuthRequiredError" ||
    name === "ForbiddenPermissionError" ||
    msg === "Permission denied" ||
    msg.toLowerCase().includes("unauthorized") ||
    msg.toLowerCase().includes("permission denied") ||
    msg.toLowerCase().includes("forbidden")
  ) {
    return {
      category: ERROR_CATEGORIES.AUTHORIZATION,
      code: code || "UNAUTHORIZED",
      message: "Permission denied or unauthorized",
      retryable: false,
    };
  }

  // 4. Conflict / Concurrency Errors
  if (
    name === "OptimisticLockError" ||
    name === "ConflictError" ||
    code === "23505" || // Postgres unique violation
    msg.toLowerCase().includes("conflict") ||
    msg.toLowerCase().includes("duplicate key") ||
    msg.toLowerCase().includes("already exists") ||
    msg.toLowerCase().includes("optimistic lock")
  ) {
    return {
      category: ERROR_CATEGORIES.CONFLICT,
      code: code || "CONCURRENCY_CONFLICT",
      message: "Resource state conflict or duplicate key",
      retryable: true,
    };
  }

  // 5. Dependency / External Service Unavailable
  if (
    name === "AiTimeoutError" ||
    name === "AiRateLimitError" ||
    name === "AiProviderError" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "503" ||
    code === "429" ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("connection refused") ||
    msg.toLowerCase().includes("database unavailable")
  ) {
    return {
      category: ERROR_CATEGORIES.DEPENDENCY_UNAVAILABLE,
      code: code || "DEPENDENCY_UNAVAILABLE",
      message: "Upstream or external dependency unavailable",
      retryable: true,
    };
  }

  // 6. Retryable External Errors
  if (
    name === "RetryableJobError" ||
    code === "GOOGLE_RATE_LIMIT" ||
    code === "GOOGLE_SERVER_ERROR" ||
    msg.toLowerCase().includes("transient error") ||
    msg.toLowerCase().includes("try again later")
  ) {
    return {
      category: ERROR_CATEGORIES.RETRYABLE_EXTERNAL,
      code: code || "RETRYABLE_EXTERNAL_ERROR",
      message: "External system transient error; retryable",
      retryable: true,
    };
  }

  // 7. Permanent External Errors
  if (
    name === "PermanentJobError" ||
    code === "GOOGLE_AUTH_ERROR" ||
    code === "GOOGLE_CALENDAR_NOT_FOUND" ||
    msg.toLowerCase().includes("needs reauthorization") ||
    msg.toLowerCase().includes("invalid grant")
  ) {
    return {
      category: ERROR_CATEGORIES.PERMANENT_EXTERNAL,
      code: code || "PERMANENT_EXTERNAL_ERROR",
      message: "External system permanent failure; re-auth or manual fix required",
      retryable: false,
    };
  }

  // 8. Default Internal Error
  return {
    category: ERROR_CATEGORIES.INTERNAL,
    code: code || "INTERNAL_ERROR",
    message: msg || "Internal server error",
    retryable: false,
  };
}

export function getFriendlyErrorMessage(error: unknown): string {
  const cat = categorizeError(error);
  switch (cat.category) {
    case ERROR_CATEGORIES.CONFLICT:
      return "Выбранный слот или ресурс больше недоступен либо пересекается с другой записью.";
    case ERROR_CATEGORIES.AUTHORIZATION:
    case ERROR_CATEGORIES.TENANT_SCOPE:
      return "Недостаточно прав для выполнения этого действия.";
    case ERROR_CATEGORIES.VALIDATION:
      if (
        cat.message &&
        !cat.message.toLowerCase().includes("sql") &&
        !cat.message.toLowerCase().includes("select") &&
        !cat.message.toLowerCase().includes("syntax")
      ) {
        return cat.message;
      }
      return "Пожалуйста, проверьте корректность заполнения обязательных полей.";
    case ERROR_CATEGORIES.DEPENDENCY_UNAVAILABLE:
    case ERROR_CATEGORIES.RETRYABLE_EXTERNAL:
      return "Сервис временно недоступен. Пожалуйста, повторите попытку через минуту.";
    case ERROR_CATEGORIES.PERMANENT_EXTERNAL:
      return "Ошибка внешней интеграции. Требуется повторная авторизация или проверка настроек.";
    case ERROR_CATEGORIES.INTERNAL:
    default:
      if (
        cat.message &&
        !cat.message.toLowerCase().includes("syntax") &&
        !cat.message.toLowerCase().includes("sql") &&
        !cat.message.toLowerCase().includes("select") &&
        !cat.message.toLowerCase().includes("relation") &&
        !cat.message.toLowerCase().includes("drizzle")
      ) {
        return cat.message;
      }
      return "Не удалось завершить операцию. Обновите страницу и попробуйте снова.";
  }
}
