import { describe, it, expect } from "vitest";
import { logger, sanitizeValue } from "@/lib/observability/logger";
import {
  extractCorrelationId,
  withCorrelationContext,
  getCorrelationId,
} from "@/lib/observability/correlation";
import {
  categorizeError,
  ERROR_CATEGORIES,
} from "@/lib/observability/error-taxonomy";
import { ROLE_CAPABILITIES } from "@/lib/permissions";

describe("Phase 15: Observability Unit Tests", () => {
  describe("Structured Logging & Secret Redaction (Section 2 & Test Matrix #14, #17)", () => {
    it("redacts sensitive fields like access tokens, client secrets and medical forms", () => {
      const payload = {
        studioId: "std-123",
        userId: "usr-456",
        accessToken: "secret_access_token_12345",
        refreshToken: "secret_refresh_token_67890",
        encryptedAccessToken: "enc_token_abc",
        clientSecret: "my_oauth_secret",
        apiKey: "api_key_xxx",
        signatureDataUrl: "data:image/png;base64,sensitive_signature_data",
        medicalForm: { allergies: "none" },
        cardNumber: "4111222233334444",
        nested: {
          token: "bearer 12345",
          normalField: "visible",
        },
      };

      const sanitized = sanitizeValue(payload) as Record<string, any>;

      expect(sanitized.accessToken).toBe("[REDACTED]");
      expect(sanitized.refreshToken).toBe("[REDACTED]");
      expect(sanitized.encryptedAccessToken).toBe("[REDACTED]");
      expect(sanitized.clientSecret).toBe("[REDACTED]");
      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.signatureDataUrl).toBe("[REDACTED]");
      expect(sanitized.medicalForm).toBe("[REDACTED]");
      expect(sanitized.cardNumber).toBe("[REDACTED]");
      expect(sanitized.nested.token).toBe("[REDACTED]");
      expect(sanitized.nested.normalField).toBe("visible");
      expect(sanitized.studioId).toBe("std-123");
    });

    it("redacts bearer tokens in string messages", () => {
      const msg = "Outgoing request with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test";
      const sanitized = sanitizeValue(msg);
      expect(sanitized).toBe("Outgoing request with Authorization: Bearer [REDACTED]");
    });

    it("logs structured entry with metadata", () => {
      const entry = logger.info("Test event", {
        studioId: "studio-1",
        feature: "google_sync",
        entityType: "appointment",
        entityId: "app-100",
      });

      expect(entry.level).toBe("info");
      expect(entry.message).toBe("Test event");
      expect(entry.studioId).toBe("studio-1");
      expect(entry.feature).toBe("google_sync");
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe("Correlation & Request IDs (Section 3)", () => {
    it("extracts correlation ID from request headers", () => {
      const headers = new Headers();
      headers.set("x-request-id", "req-custom-uuid-123");

      const extracted = extractCorrelationId(headers);
      expect(extracted).toBe("req-custom-uuid-123");
    });

    it("extracts correlation ID from plain object headers", () => {
      const headers = { "x-correlation-id": "corr-uuid-789" };
      const extracted = extractCorrelationId(headers);
      expect(extracted).toBe("corr-uuid-789");
    });

    it("generates random UUID when header is missing", () => {
      const extracted = extractCorrelationId(null);
      expect(extracted).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("propagates correlation context through AsyncLocalStorage", () => {
      const testId = "req-async-scope-1";
      withCorrelationContext({ requestId: testId, studioId: "std-scope" }, () => {
        expect(getCorrelationId()).toBe(testId);
      });
    });
  });

  describe("Error Taxonomy (Section 18)", () => {
    it("categorizes validation errors correctly", () => {
      const err = new Error("Validation failed for schema");
      err.name = "ZodError";

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.VALIDATION);
      expect(cat.retryable).toBe(false);
    });

    it("categorizes tenant scope errors correctly", () => {
      const err = new Error("Tenant isolation mismatch");
      err.name = "StudioScopeError";

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.TENANT_SCOPE);
      expect(cat.retryable).toBe(false);
    });

    it("categorizes authorization errors correctly", () => {
      const err = new Error("Permission denied");

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.AUTHORIZATION);
      expect(cat.retryable).toBe(false);
    });

    it("categorizes concurrency conflicts as retryable", () => {
      const err = new Error("optimistic lock failed");
      err.name = "OptimisticLockError";

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.CONFLICT);
      expect(cat.retryable).toBe(true);
    });

    it("categorizes timeout and rate limits as dependency unavailable", () => {
      const err = new Error("Rate limit exceeded 429");
      err.name = "AiRateLimitError";

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.DEPENDENCY_UNAVAILABLE);
      expect(cat.retryable).toBe(true);
    });

    it("categorizes permanent external failures as non-retryable", () => {
      const err = new Error("Google account needs reauthorization");
      err.name = "PermanentJobError";

      const cat = categorizeError(err);
      expect(cat.category).toBe(ERROR_CATEGORIES.PERMANENT_EXTERNAL);
      expect(cat.retryable).toBe(false);
    });
  });

  describe("Permissions & Role Capabilities (Section 25 & Test Matrix #21, #22)", () => {
    it("grants OWNER full OPERATIONS_READ and OPERATIONS_MANAGE capabilities", () => {
      expect(ROLE_CAPABILITIES.OWNER).toContain("OPERATIONS_READ");
      expect(ROLE_CAPABILITIES.OWNER).toContain("OPERATIONS_MANAGE");
    });

    it("grants ADMIN operations capabilities according to policy", () => {
      expect(ROLE_CAPABILITIES.ADMIN).toContain("OPERATIONS_READ");
      expect(ROLE_CAPABILITIES.ADMIN).toContain("OPERATIONS_MANAGE");
    });

    it("denies MASTER global operations access", () => {
      expect(ROLE_CAPABILITIES.MASTER).not.toContain("OPERATIONS_READ");
      expect(ROLE_CAPABILITIES.MASTER).not.toContain("OPERATIONS_MANAGE");
    });

    it("denies AI_SYSTEM operations access", () => {
      expect(ROLE_CAPABILITIES.AI_SYSTEM).not.toContain("OPERATIONS_READ");
      expect(ROLE_CAPABILITIES.AI_SYSTEM).not.toContain("OPERATIONS_MANAGE");
    });
  });
});
