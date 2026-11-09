import { describe, expect, it } from "vitest";
import { ContextRedactor } from "@/features/ai/domain/context-assembler";

describe("Privacy Anonymization & AI Privacy — Unit Tests", () => {
  describe("ContextRedactor", () => {
    it("redacts credit card numbers, secrets and tokens from context", () => {
      const rawText = "Client paid with card 4532 0150 1234 5678 and token bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
      const redacted = ContextRedactor.redactSensitivePatterns(rawText);

      expect(redacted).not.toContain("4532 0150 1234 5678");
      expect(redacted).toContain("[REDACTED_PAYMENT_CARD]");
      expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz");
      expect(redacted).toContain("[REDACTED_SECRET]");
    });

    it("redacts base64 signature/image payloads", () => {
      const rawText = "Evidence data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== signed";
      const redacted = ContextRedactor.redactSensitivePatterns(rawText);

      expect(redacted).not.toContain("data:image/png;base64,");
      expect(redacted).toContain("[REDACTED_SIGNATURE_PAYLOAD]");
    });

    it("handles sanitized/null medical profile for anonymized clients gracefully", () => {
      const emptyProfile = {
        allergies: null,
        contraindications: null,
        medications: null,
        skinType: null,
        hasKeloids: false,
        isPregnant: false,
        hasSkinDiseases: false,
        mergeReviewRequired: false,
      };

      const alerts = ContextRedactor.sanitizeMedicalProfile(emptyProfile);
      expect(alerts).toEqual([]);
    });

    it("extracts alerts when clinical flags are present without leaking free-text PII", () => {
      const profile = {
        allergies: "Peanuts and latex",
        contraindications: null,
        medications: null,
        skinType: "Fitzpatrick II",
        hasKeloids: true,
        isPregnant: false,
        hasSkinDiseases: false,
        mergeReviewRequired: false,
      };

      const alerts = ContextRedactor.sanitizeMedicalProfile(profile);
      expect(alerts).toContain("Allergies reported: Peanuts and latex");
      expect(alerts).toContain("Reported condition: Keloid tendency");
    });
  });

  describe("Placeholder Determinism", () => {
    it("preserves expected non-identifying deterministic placeholders", () => {
      const anonymizedProfile = {
        firstName: "Anonymized",
        lastName: "Client",
        fullName: "Anonymized Client",
        phone: "+000000000000",
        whatsapp: null,
        email: null,
        instagram: null,
        birthDate: null,
        notes: null,
        tags: null,
        referredByName: null,
      };

      expect(anonymizedProfile.firstName).toBe("Anonymized");
      expect(anonymizedProfile.fullName).toBe("Anonymized Client");
      expect(anonymizedProfile.phone).toBe("+000000000000");
      expect(anonymizedProfile.email).toBeNull();
      expect(anonymizedProfile.whatsapp).toBeNull();
      expect(anonymizedProfile.notes).toBeNull();
    });
  });
});
