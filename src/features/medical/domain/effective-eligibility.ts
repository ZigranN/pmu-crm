/**
 * Pure domain evaluator for Effective Medical Eligibility.
 * 
 * Rules:
 * - Deterministic, synchronous, and side-effect-free.
 * - No database access, auth, Next.js, or server actions.
 * - Pure domain logic only.
 */

export type EffectiveMedicalEligibilityStatus =
  | "CLEARED"
  | "CONSULTATION_REQUIRED"
  | "NOT_CLEARED"
  | "REVIEW_REQUIRED"
  | "NOT_APPLICABLE";

export type EffectiveMedicalEligibilityReasonCode =
  | "CLEARED"
  | "CONSULTATION_REQUIRED"
  | "NOT_CLEARED"
  | "CYCLE_TERMINAL"
  | "NO_MEDICAL_PROFILE"
  | "NO_MEDICAL_REVISION"
  | "NO_CLEARANCE"
  | "MEDICAL_REVISION_CHANGED"
  | "CLIENT_REVISION_MISMATCH"
  | "MERGE_REVIEW_REQUIRED"
  | "PROFILE_REVISION_MISMATCH"
  | "CLEARANCE_CYCLE_MISMATCH";

export type CycleMedicalClearanceDecision =
  | "CLEARED"
  | "CONSULTATION_REQUIRED"
  | "NOT_CLEARED";

export const TERMINAL_CYCLE_STAGES = [
  "cycle_completed",
  "refresh_no_response",
  "lost",
] as const;

export type TerminalCycleStage = (typeof TERMINAL_CYCLE_STAGES)[number];

export function isTerminalCycleStage(stage: string): boolean {
  return TERMINAL_CYCLE_STAGES.includes(stage as TerminalCycleStage);
}

const TEXT_FIELDS = [
  "allergies",
  "contraindications",
  "skinType",
  "pregnancyStatus",
  "medications",
  "previousPMUNotes",
  "medicalNotes",
] as const;

const BOOLEAN_FIELDS = [
  "previousPMU",
  "herpesHistory",
  "diabetes",
  "bloodThinners",
  "keloidRisk",
  "autoimmuneDiseases",
  "recentBotoxFillers",
  "recentPeelingLaser",
  "skinSensitivity",
] as const;

export const MEDICAL_PROFILE_SNAPSHOT_FIELDS = [
  ...TEXT_FIELDS,
  ...BOOLEAN_FIELDS,
] as const;

export type MedicalProfileSnapshotField =
  (typeof MEDICAL_PROFILE_SNAPSHOT_FIELDS)[number];

export type MedicalProfileSnapshot = {
  [K in (typeof TEXT_FIELDS)[number]]: string | null;
} & {
  [K in (typeof BOOLEAN_FIELDS)[number]]: boolean;
};

export function normalizeMedicalProfileSnapshot(
  source: Partial<Record<string, unknown>> | null | undefined
): MedicalProfileSnapshot {
  const snapshot = {} as Record<string, string | boolean | null>;
  const safeSource = source ?? {};

  for (const field of TEXT_FIELDS) {
    const value = safeSource[field];
    snapshot[field] = typeof value === "string" ? value : null;
  }

  for (const field of BOOLEAN_FIELDS) {
    snapshot[field] = safeSource[field] === true;
  }

  return snapshot as MedicalProfileSnapshot;
}

export function hasMedicalProfileSnapshotMismatch(
  profileSource: Partial<Record<string, unknown>> | null | undefined,
  revisionSnapshot: Partial<Record<string, unknown>> | null | undefined
): boolean {
  const normalizedProfile = normalizeMedicalProfileSnapshot(profileSource);
  const normalizedRevision = normalizeMedicalProfileSnapshot(revisionSnapshot);

  return MEDICAL_PROFILE_SNAPSHOT_FIELDS.some(
    (field) => normalizedProfile[field] !== normalizedRevision[field]
  );
}

export interface EffectiveMedicalEligibilityInput {
  cycleId: string;
  clientId: string;
  cycleStage: string;
  currentMedicalProfile?: {
    allergies?: string | null;
    contraindications?: string | null;
    skinType?: string | null;
    pregnancyStatus?: string | null;
    medications?: string | null;
    previousPMUNotes?: string | null;
    medicalNotes?: string | null;
    previousPMU?: boolean | null;
    herpesHistory?: boolean | null;
    diabetes?: boolean | null;
    bloodThinners?: boolean | null;
    keloidRisk?: boolean | null;
    autoimmuneDiseases?: boolean | null;
    recentBotoxFillers?: boolean | null;
    recentPeelingLaser?: boolean | null;
    skinSensitivity?: boolean | null;
    mergeReviewRequired?: boolean | null;
    [key: string]: unknown;
  } | null;
  currentMedicalRevision?: {
    id: string;
    clientId: string;
    revisionNumber: number;
    snapshot: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  latestCycleMedicalClearance?: {
    id: string;
    cycleId: string;
    medicalRevisionId: string;
    decisionNumber: number;
    decision: CycleMedicalClearanceDecision;
    [key: string]: unknown;
  } | null;
  mergeReviewRequired?: boolean | null;
}

export interface EffectiveMedicalEligibility {
  status: EffectiveMedicalEligibilityStatus;
  reasonCode: EffectiveMedicalEligibilityReasonCode;
  cycleId: string;
  clientId: string;
  isTerminalCycle: boolean;
  currentMedicalRevisionId: string | null;
  currentMedicalRevisionNumber: number | null;
  latestClearanceId: string | null;
  clearanceMedicalRevisionId: string | null;
  decisionNumber: number | null;
  humanDecision: CycleMedicalClearanceDecision | null;
}

/**
 * Deterministically evaluates effective medical eligibility based on provided evidence.
 * Follows strict 9-step precedence ordering.
 */
export function evaluateEffectiveMedicalEligibility(
  input: EffectiveMedicalEligibilityInput
): EffectiveMedicalEligibility {
  const {
    cycleId,
    clientId,
    cycleStage,
    currentMedicalProfile,
    currentMedicalRevision,
    latestCycleMedicalClearance,
    mergeReviewRequired: explicitMergeReviewRequired,
  } = input;

  const currentMedicalRevisionId = currentMedicalRevision?.id ?? null;
  const currentMedicalRevisionNumber =
    currentMedicalRevision?.revisionNumber ?? null;
  const latestClearanceId = latestCycleMedicalClearance?.id ?? null;
  const clearanceMedicalRevisionId =
    latestCycleMedicalClearance?.medicalRevisionId ?? null;
  const decisionNumber = latestCycleMedicalClearance?.decisionNumber ?? null;
  const humanDecision = latestCycleMedicalClearance?.decision ?? null;

  // Step 1 — Terminal cycle
  if (isTerminalCycleStage(cycleStage)) {
    return {
      status: "NOT_APPLICABLE",
      reasonCode: "CYCLE_TERMINAL",
      cycleId,
      clientId,
      isTerminalCycle: true,
      currentMedicalRevisionId,
      currentMedicalRevisionNumber,
      latestClearanceId,
      clearanceMedicalRevisionId,
      decisionNumber,
      humanDecision,
    };
  }

  // Helper for non-terminal result
  const buildResult = (
    status: EffectiveMedicalEligibilityStatus,
    reasonCode: EffectiveMedicalEligibilityReasonCode
  ): EffectiveMedicalEligibility => ({
    status,
    reasonCode,
    cycleId,
    clientId,
    isTerminalCycle: false,
    currentMedicalRevisionId,
    currentMedicalRevisionNumber,
    latestClearanceId,
    clearanceMedicalRevisionId,
    decisionNumber,
    humanDecision,
  });

  // Step 2 — Missing profile
  if (!currentMedicalProfile) {
    return buildResult("REVIEW_REQUIRED", "NO_MEDICAL_PROFILE");
  }

  // Step 3 — Missing revision
  if (!currentMedicalRevision) {
    return buildResult("REVIEW_REQUIRED", "NO_MEDICAL_REVISION");
  }

  // Step 4 — Merge review
  const isMergeReviewRequired =
    explicitMergeReviewRequired === true ||
    currentMedicalProfile.mergeReviewRequired === true;

  if (isMergeReviewRequired) {
    return buildResult("REVIEW_REQUIRED", "MERGE_REVIEW_REQUIRED");
  }

  // Step 5 — Revision ownership
  if (currentMedicalRevision.clientId !== clientId) {
    return buildResult("REVIEW_REQUIRED", "CLIENT_REVISION_MISMATCH");
  }

  // Step 6 — Current profile/revision coherence
  if (
    hasMedicalProfileSnapshotMismatch(
      currentMedicalProfile,
      currentMedicalRevision.snapshot
    )
  ) {
    return buildResult("REVIEW_REQUIRED", "PROFILE_REVISION_MISMATCH");
  }

  // Step 7 — Missing clearance
  if (!latestCycleMedicalClearance) {
    return buildResult("REVIEW_REQUIRED", "NO_CLEARANCE");
  }

  // Clearance cycle ownership check
  if (latestCycleMedicalClearance.cycleId !== cycleId) {
    return buildResult("REVIEW_REQUIRED", "CLEARANCE_CYCLE_MISMATCH");
  }

  // Step 8 — Stale clearance
  if (latestCycleMedicalClearance.medicalRevisionId !== currentMedicalRevision.id) {
    return buildResult("REVIEW_REQUIRED", "MEDICAL_REVISION_CHANGED");
  }

  // Step 9 — Applicable human decision
  const decision = latestCycleMedicalClearance.decision;
  return buildResult(decision, decision);
}
