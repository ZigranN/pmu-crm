import { describe, expect, it } from "vitest";
import {
  evaluateEffectiveConsent,
  type EffectiveConsentInput,
} from "@/features/consent/domain/effective-consent";

describe("Pure Effective Consent Evaluator", () => {
  const baseInput: EffectiveConsentInput = {
    cycleId: "cycle-123",
    clientId: "client-456",
    cycleStage: "in_progress",
    cycleZoneCode: "brows",
    latestCycleConsent: {
      id: "consent-789",
      cycleId: "cycle-123",
      clientId: "client-456",
      templateVersionId: "ver-001",
      status: "SIGNED",
      mediaId: "media-999",
      signedAt: new Date("2026-10-01T10:00:00Z"),
      signedPdfSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    coveredZoneCodes: ["brows", "lips"],
    evaluationTime: new Date("2026-10-05T12:00:00Z"),
  };

  it("1. Returns COVERED with CONSENT_VALID when signed consent matches cycle, client, and zone", () => {
    const result = evaluateEffectiveConsent(baseInput);

    expect(result.status).toBe("COVERED");
    expect(result.reason).toBe("CONSENT_VALID");
    expect(result.cycleId).toBe("cycle-123");
    expect(result.clientId).toBe("client-456");
    expect(result.consentId).toBe("consent-789");
    expect(result.templateVersionId).toBe("ver-001");
    expect(result.mediaId).toBe("media-999");
    expect(result.signedAt).toEqual(new Date("2026-10-01T10:00:00Z"));
    expect(result.coveredZoneCodes).toEqual(["brows", "lips"]);
  });

  it("2. Returns NOT_APPLICABLE with CYCLE_TERMINAL for terminal cycle stages", () => {
    const stages = ["cycle_completed", "refresh_no_response", "lost"];
    for (const stage of stages) {
      const result = evaluateEffectiveConsent({
        ...baseInput,
        cycleStage: stage,
      });
      expect(result.status).toBe("NOT_APPLICABLE");
      expect(result.reason).toBe("CYCLE_TERMINAL");
    }
  });

  it("3. Returns CONSENT_REQUIRED with NO_SIGNED_CONSENT when no consent exists", () => {
    const result = evaluateEffectiveConsent({
      ...baseInput,
      latestCycleConsent: null,
    });

    expect(result.status).toBe("CONSENT_REQUIRED");
    expect(result.reason).toBe("NO_SIGNED_CONSENT");
    expect(result.consentId).toBeNull();
  });

  it("4. Returns CONSENT_REQUIRED with NO_SIGNED_CONSENT when consent is still in DRAFT status", () => {
    const result = evaluateEffectiveConsent({
      ...baseInput,
      latestCycleConsent: {
        ...baseInput.latestCycleConsent!,
        status: "DRAFT",
        signedAt: null,
        mediaId: null,
      },
    });

    expect(result.status).toBe("CONSENT_REQUIRED");
    expect(result.reason).toBe("NO_SIGNED_CONSENT");
  });

  it("5. Returns CONSENT_REQUIRED with CYCLE_MISMATCH when consent belongs to a different cycle", () => {
    const result = evaluateEffectiveConsent({
      ...baseInput,
      latestCycleConsent: {
        ...baseInput.latestCycleConsent!,
        cycleId: "other-cycle-999",
      },
    });

    expect(result.status).toBe("CONSENT_REQUIRED");
    expect(result.reason).toBe("CYCLE_MISMATCH");
    expect(result.consentId).toBe("consent-789");
  });

  it("6. Returns CONSENT_REQUIRED with CLIENT_PROVENANCE_MISMATCH when historical signing client differs (e.g. after merge)", () => {
    const result = evaluateEffectiveConsent({
      ...baseInput,
      latestCycleConsent: {
        ...baseInput.latestCycleConsent!,
        clientId: "source-client-old",
      },
    });

    expect(result.status).toBe("CONSENT_REQUIRED");
    expect(result.reason).toBe("CLIENT_PROVENANCE_MISMATCH");
    expect(result.consentId).toBe("consent-789");
  });

  it("7. Returns CONSENT_REQUIRED with ZONE_NOT_COVERED when cycle zone is not among covered zones", () => {
    const result = evaluateEffectiveConsent({
      ...baseInput,
      cycleZoneCode: "eyeliner",
      coveredZoneCodes: ["brows", "lips"],
    });

    expect(result.status).toBe("CONSENT_REQUIRED");
    expect(result.reason).toBe("ZONE_NOT_COVERED");
    expect(result.consentId).toBe("consent-789");
  });

  it("8. Is strictly side-effect free and does not mutate input object or coveredZoneCodes array", () => {
    const frozenZones = Object.freeze(["brows", "lips"]);
    const input: EffectiveConsentInput = Object.freeze({
      ...baseInput,
      coveredZoneCodes: frozenZones,
    });

    const result = evaluateEffectiveConsent(input);
    expect(result.status).toBe("COVERED");
    expect(input.coveredZoneCodes).toEqual(["brows", "lips"]);
  });
});
