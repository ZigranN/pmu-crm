/**
 * Pure domain evaluator for Effective Consent.
 * 
 * Rules:
 * - Deterministic, synchronous, and side-effect-free.
 * - No database access, auth, Next.js, or server actions.
 * - Pure domain logic only.
 */

export type EffectiveConsentStatus =
  | "COVERED"
  | "CONSENT_REQUIRED"
  | "NOT_APPLICABLE";

export type EffectiveConsentReasonCode =
  | "CONSENT_VALID"
  | "NO_SIGNED_CONSENT"
  | "ZONE_NOT_COVERED"
  | "CLIENT_PROVENANCE_MISMATCH"
  | "CYCLE_MISMATCH"
  | "CYCLE_TERMINAL";

export const TERMINAL_CYCLE_STAGES = [
  "cycle_completed",
  "refresh_no_response",
  "lost",
] as const;

export type TerminalCycleStage = (typeof TERMINAL_CYCLE_STAGES)[number];

export function isTerminalCycleStage(stage: string): boolean {
  return TERMINAL_CYCLE_STAGES.includes(stage as TerminalCycleStage);
}

export interface SignedCycleConsentEvidence {
  id: string;
  cycleId: string;
  clientId: string;
  templateVersionId: string;
  status: "DRAFT" | "SIGNED" | string;
  mediaId: string | null;
  signedAt: Date | null;
  signedPdfSha256?: string | null;
}

export interface EffectiveConsentInput {
  cycleId: string;
  clientId: string;
  cycleStage: string;
  cycleZoneCode: string;
  latestCycleConsent: SignedCycleConsentEvidence | null;
  coveredZoneCodes: readonly string[];
  evaluationTime?: Date;
}

export interface EffectiveConsent {
  status: EffectiveConsentStatus;
  reason: EffectiveConsentReasonCode;
  cycleId: string;
  clientId: string;
  cycleStage: string;
  cycleZoneCode: string;
  consentId: string | null;
  templateVersionId: string | null;
  mediaId: string | null;
  signedAt: Date | null;
  coveredZoneCodes: string[];
  evaluatedAt: Date;
}

/**
 * Pure, side-effect-free evaluation of effective consent coverage for a TreatmentCycle.
 */
export function evaluateEffectiveConsent(
  input: EffectiveConsentInput
): EffectiveConsent {
  const evaluatedAt = input.evaluationTime ?? new Date();
  const coveredZoneCodes = [...input.coveredZoneCodes];

  const buildResult = (
    status: EffectiveConsentStatus,
    reason: EffectiveConsentReasonCode,
    consent: SignedCycleConsentEvidence | null = input.latestCycleConsent
  ): EffectiveConsent => ({
    status,
    reason,
    cycleId: input.cycleId,
    clientId: input.clientId,
    cycleStage: input.cycleStage,
    cycleZoneCode: input.cycleZoneCode,
    consentId: consent?.id ?? null,
    templateVersionId: consent?.templateVersionId ?? null,
    mediaId: consent?.mediaId ?? null,
    signedAt: consent?.signedAt ?? null,
    coveredZoneCodes,
    evaluatedAt,
  });

  // Step 1 — Terminal cycles are not applicable for active consent requirements
  if (isTerminalCycleStage(input.cycleStage)) {
    return buildResult("NOT_APPLICABLE", "CYCLE_TERMINAL");
  }

  // Step 2 — Missing or non-signed consent
  if (
    !input.latestCycleConsent ||
    input.latestCycleConsent.status !== "SIGNED" ||
    !input.latestCycleConsent.signedAt ||
    !input.latestCycleConsent.mediaId
  ) {
    return buildResult("CONSENT_REQUIRED", "NO_SIGNED_CONSENT", null);
  }

  const consent = input.latestCycleConsent;

  // Step 3 — Cycle mismatch
  if (consent.cycleId !== input.cycleId) {
    return buildResult("CONSENT_REQUIRED", "CYCLE_MISMATCH", consent);
  }

  // Step 4 — Client provenance mismatch (historical client does not match current cycle client, e.g. after merge)
  if (consent.clientId !== input.clientId) {
    return buildResult(
      "CONSENT_REQUIRED",
      "CLIENT_PROVENANCE_MISMATCH",
      consent
    );
  }

  // Step 5 — Zone coverage verification
  if (!coveredZoneCodes.includes(input.cycleZoneCode)) {
    return buildResult("CONSENT_REQUIRED", "ZONE_NOT_COVERED", consent);
  }

  // Step 6 — Fully valid signed consent covering the cycle's actual zone
  return buildResult("COVERED", "CONSENT_VALID", consent);
}
