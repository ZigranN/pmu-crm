import { describe, it, expect, beforeEach } from "vitest";
import { FakeAiProvider } from "@/features/ai/providers/fake-provider";
import {
  AiMalformedOutputError,
  AiRateLimitError,
  AiTimeoutError,
} from "@/features/ai/providers/types";
import {
  ClientSummaryOutputSchema,
  ReplyDraftOutputSchema,
  type SuggestedActionInput,
} from "@/features/ai/schemas/ai.schema";
import { PROMPT_VERSIONS } from "@/features/ai/prompts/versions";
import {
  checkActionProhibitions,
  guardSuggestedActions,
  enforceStrictGuardrails,
  sanitizeReplyDraft,
  AiGuardrailViolationError,
} from "@/features/ai/domain/guardrails";
import { ContextRedactor } from "@/features/ai/domain/context-assembler";
import { AiRateLimiter, withBoundedRetry } from "@/features/ai/server/rate-limiter";

describe("Phase 13: AI Copilot Unit Tests", () => {
  let fakeProvider: FakeAiProvider;

  beforeEach(() => {
    fakeProvider = new FakeAiProvider();
  });

  describe("1. Provider Abstraction & Structured Outputs", () => {
    it("accepts valid structured output matching Zod schema (Test Matrix #1)", async () => {
      const result = await fakeProvider.generateStructured(
        {
          prompt: "Summarize client",
          schema: ClientSummaryOutputSchema,
        },
        PROMPT_VERSIONS.CLIENT_SUMMARY
      );

      expect(result.data.summary).toBeDefined();
      expect(result.data.dataConfidence).toBe("high");
      expect(result.promptVersion).toBe(PROMPT_VERSIONS.CLIENT_SUMMARY);
      expect(result.usage?.inputTokens).toBeGreaterThan(0);
    });

    it("rejects malformed output not matching Zod schema (Test Matrix #2)", async () => {
      fakeProvider.structuredHandler = () => ({
        // missing mandatory summary string
        blockers: [],
      });

      await expect(
        fakeProvider.generateStructured(
          {
            prompt: "Summarize client",
            schema: ClientSummaryOutputSchema,
          },
          PROMPT_VERSIONS.CLIENT_SUMMARY
        )
      ).rejects.toThrow(AiMalformedOutputError);
    });

    it("handles provider timeout (Test Matrix #3)", async () => {
      fakeProvider.simulateTimeout = true;

      await expect(
        fakeProvider.generateStructured(
          {
            prompt: "Summarize client",
            schema: ClientSummaryOutputSchema,
          },
          PROMPT_VERSIONS.CLIENT_SUMMARY
        )
      ).rejects.toThrow(AiTimeoutError);
    });

    it("handles 429 rate limit safely (Test Matrix #4)", async () => {
      fakeProvider.simulateRateLimit = true;

      await expect(
        fakeProvider.generateStructured(
          {
            prompt: "Summarize client",
            schema: ClientSummaryOutputSchema,
          },
          PROMPT_VERSIONS.CLIENT_SUMMARY
        )
      ).rejects.toThrow(AiRateLimitError);
    });
  });

  describe("2. Deterministic Guardrails & Mutation Prohibitions", () => {
    it("rejects AI suggestion to bypass or change medical clearance (Test Matrix #15)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-med-1",
        label: "Clear Medical Profile",
        actionType: "CHANGE_MEDICAL_CLEARANCE",
        description: "Mark medical clearance as approved autonomously.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();
      expect(violation?.code).toBe("PROHIBITED_AUTONOMOUS_ACTION_TYPE");

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("rejects AI suggestion to bypass consent (Test Matrix #16)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-cons-1",
        label: "Bypass Consent Requirement",
        actionType: "VIEW_CLIENT",
        description: "Ignore consent and proceed without client signature.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();
      expect(violation?.code).toBe("PROHIBITED_CONSENT_MUTATION");

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("rejects payment / refund / ledger entry mutations (Test Matrix #17)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-pay-1",
        label: "Issue Full Refund",
        actionType: "REFUND_PAYMENT",
        description: "Refund client deposit and alter ledger entries.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("rejects procedure start/complete mutations (Test Matrix #18)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-proc-1",
        label: "Auto-Start Procedure",
        actionType: "START_PROCEDURE",
        description: "Start procedure session now.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("rejects autonomous external message sending (Test Matrix #19)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-msg-1",
        label: "Auto-Send WhatsApp",
        actionType: "AUTO_SEND_MESSAGE",
        description: "Deliver message without review.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("rejects Google integration mutations (Test Matrix #20)", () => {
      const prohibitedAction: SuggestedActionInput = {
        id: "act-gcal-1",
        label: "Disconnect Google Account",
        actionType: "DISCONNECT_GOOGLE",
        description: "Disconnect Google integration.",
      };

      const violation = checkActionProhibitions(prohibitedAction);
      expect(violation).not.toBeNull();

      expect(() => enforceStrictGuardrails([prohibitedAction])).toThrow(
        AiGuardrailViolationError
      );
    });

    it("enforces deterministic blockers over AI suggestions (Test Matrix #9, #15)", () => {
      const action: SuggestedActionInput = {
        id: "act-adv-1",
        label: "Schedule Procedure",
        actionType: "SCHEDULE_APPOINTMENT_MANUAL",
        description: "Proceed to treatment procedure session.",
      };

      // When medical status is REVIEW_REQUIRED
      const { guardedActions } = guardSuggestedActions([action], {
        medicalClearanceStatus: "REVIEW_REQUIRED",
      });

      expect(guardedActions[0].actionType).toBe("REVIEW_MEDICAL_PROFILE");
      expect(guardedActions[0].label).toBe("Review Medical Profile");
      expect(guardedActions[0].blockedReason).toContain("Deterministic medical review blocker");
    });
  });

  describe("3. Privacy, Data Minimization & Context Redaction", () => {
    it("redacts credit cards, auth tokens, and base64 signature payloads (Test Matrix #5, #6)", () => {
      const sensitiveInput =
        "Customer card: 4111 2222 3333 4444. Auth bearer token: bearer secret_token_1234567890123456. Raw signature: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      const redacted = ContextRedactor.redactSensitivePatterns(sensitiveInput);

      expect(redacted).not.toContain("4111 2222 3333 4444");
      expect(redacted).toContain("[REDACTED_PAYMENT_CARD]");
      expect(redacted).not.toContain("secret_token_1234567890123456");
      expect(redacted).toContain("[REDACTED_SECRET]");
      expect(redacted).not.toContain("iVBORw0KGgoAAAANSUhEUg");
      expect(redacted).toContain("[REDACTED_SIGNATURE_PAYLOAD]");
    });

    it("minimizes medical context and avoids raw diagnosis (Test Matrix #7)", () => {
      const profile = {
        allergies: "Lidocaine 1234567890123456",
        hasDiabetes: true,
        contraindications: "None",
      };

      const sanitized = ContextRedactor.sanitizeMedicalProfile(profile);

      expect(sanitized).toEqual([
        "Allergies reported: Lidocaine [REDACTED_PAYMENT_CARD]",
        "Reported condition: Diabetes",
      ]);
    });
  });

  describe("4. Reply Drafting & Human Review Safety", () => {
    it("generates reply draft with explicit rationale and tone (Test Matrix #12)", async () => {
      const result = await fakeProvider.generateStructured(
        {
          prompt: "Draft reply",
          schema: ReplyDraftOutputSchema,
        },
        PROMPT_VERSIONS.REPLY_DRAFT
      );

      expect(result.data.draftReply).toBeDefined();
      expect(result.data.tone).toBe("professional");
      expect(result.data.rationale).toBeDefined();
    });

    it("sanitizes reply draft and flags false autonomous execution claims (Test Matrix #13, #14)", () => {
      const draftWithFalseClaim = "Hello! I have already refunded your appointment deposit of $100.";
      const checked = sanitizeReplyDraft(draftWithFalseClaim);

      expect(checked.isSafe).toBe(false);
      expect(checked.warnings).toContain("Draft contained autonomous refund claim; human verification required.");
    });
  });

  describe("5. Rate Limiting & Bounded Retry", () => {
    it("enforces window-based rate limiting per user/studio (Test Matrix #17)", () => {
      const limiter = new AiRateLimiter({ windowMs: 1000, maxRequests: 2 });
      const key = "studio-1:user-1";

      expect(limiter.checkRateLimit(key).allowed).toBe(true);
      expect(limiter.checkRateLimit(key).allowed).toBe(true);
      expect(limiter.checkRateLimit(key).allowed).toBe(false);
    });

    it("performs bounded retry on transient network errors and fails gracefully", async () => {
      let attempts = 0;
      const failingFn = async () => {
        attempts++;
        const err: any = new Error("Simulated network timeout");
        err.status = 504;
        throw err;
      };

      await expect(
        withBoundedRetry(failingFn, { maxRetries: 2, initialDelayMs: 10 })
      ).rejects.toThrow("Simulated network timeout");

      expect(attempts).toBe(3); // Initial try + 2 retries
    });
  });
});
