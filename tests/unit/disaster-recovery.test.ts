import { describe, it, expect } from "vitest";
import { sanitizeDatabaseUrl, isPotentialProductionTarget } from "../../scripts/restore-postgres.mjs";
import { classifyMediaCategory } from "../../scripts/backup-media.mjs";
import { encryptSecret, decryptSecret } from "@/lib/encryption";

describe("Phase 18 Disaster Recovery Unit Tests", () => {
  describe("PostgreSQL Sanitization & Production Target Guardrails", () => {
    it("redacts credentials from connection URLs in operational logs", () => {
      const sensitiveUrl = "postgresql://pmu_admin:SuperSecretPass123!@db.internal:5432/pmu_prod";
      const sanitized = sanitizeDatabaseUrl(sensitiveUrl);

      expect(sanitized).not.toContain("SuperSecretPass123!");
      expect(sanitized).toContain("***");
      expect(sanitized).toContain("postgresql://pmu_admin:***@db.internal:5432/pmu_prod");
    });

    it("handles undefined or malformed URLs safely", () => {
      expect(sanitizeDatabaseUrl("")).toBe("[UNDEFINED]");
      expect(sanitizeDatabaseUrl("not-a-valid-url")).toBe("[MALFORMED_URL]");
    });

    it("identifies potential production target databases", () => {
      expect(isPotentialProductionTarget("postgresql://user:pass@aws.rds.amazonaws.com:5432/pmu_prod")).toBe(true);
      expect(isPotentialProductionTarget("postgresql://user:pass@ep-cool-db.neon.tech/neondb")).toBe(true);
      expect(isPotentialProductionTarget("postgresql://user:pass@127.0.0.1:5432/pmu_prod")).toBe(true);
      expect(isPotentialProductionTarget("postgresql://user:pass@127.0.0.1:5433/pmu_test")).toBe(false);
      expect(isPotentialProductionTarget("postgresql://user:pass@localhost:5433/pmu_test_123")).toBe(false);
    });
  });

  describe("Media Authoritativeness Classification", () => {
    it("classifies signed consents and cycle consents as authoritative", () => {
      const cycleConsent = classifyMediaCategory({
        is_cycle_consent: true,
        type: "consent",
      });
      expect(cycleConsent.category).toBe("signed_consent");
      expect(cycleConsent.isAuthoritative).toBe(true);

      const generalConsent = classifyMediaCategory({
        type: "consent",
      });
      expect(generalConsent.category).toBe("signed_consent");
      expect(generalConsent.isAuthoritative).toBe(true);
    });

    it("classifies procedure evidence (before/after photos) as authoritative", () => {
      const beforePhoto = classifyMediaCategory({
        procedure_session_id: "proc-123",
        type: "before",
      });
      expect(beforePhoto.category).toBe("procedure_evidence");
      expect(beforePhoto.isAuthoritative).toBe(true);

      const afterPhoto = classifyMediaCategory({
        procedure_session_id: "proc-123",
        type: "after",
      });
      expect(afterPhoto.category).toBe("procedure_evidence");
      expect(afterPhoto.isAuthoritative).toBe(true);
    });

    it("classifies client general media as authoritative", () => {
      const clientMedia = classifyMediaCategory({
        client_id: "client-123",
        type: "general",
      });
      expect(clientMedia.category).toBe("client_media");
      expect(clientMedia.isAuthoritative).toBe(true);
    });

    it("classifies privacy export artifacts and temporary uploads as re-creatable / transient", () => {
      const privacyExport = classifyMediaCategory({
        type: "privacy_export",
      });
      expect(privacyExport.category).toBe("privacy_export");
      expect(privacyExport.isAuthoritative).toBe(false);

      const tempUpload = classifyMediaCategory({
        type: "temp_staging",
      });
      expect(tempUpload.category).toBe("temporary_upload");
      expect(tempUpload.isAuthoritative).toBe(false);
    });
  });

  describe("Encryption Key Integrity & Safe Recovery", () => {
    const customKey = "test-recovery-secret-key-phase18-32b!";
    const testSecret = "oauth-refresh-token-xyz-98765";

    it("encrypts and decrypts secrets with versioned enc:v1 format", () => {
      const token = encryptSecret(testSecret, customKey);
      expect(token).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

      const decrypted = decryptSecret(token, customKey);
      expect(decrypted).toBe(testSecret);
    });

    it("fails safely when corrupt payload or wrong key is provided without leaking secret", () => {
      const token = encryptSecret(testSecret, customKey);
      const wrongKey = "completely-wrong-key-000000000000!";

      expect(() => decryptSecret(token, wrongKey)).toThrow();
      expect(() => decryptSecret("enc:v1:corrupted:tag:payload", customKey)).toThrow();
      expect(() => decryptSecret("invalid-prefix:token", customKey)).toThrow(/Invalid encrypted payload format/);
    });
  });
});
