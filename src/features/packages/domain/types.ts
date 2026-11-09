import type { EffectiveMedicalEligibilityStatus, EffectiveMedicalEligibilityReasonCode } from "@/features/medical/domain/effective-eligibility";
import type { EffectiveConsentStatus } from "@/features/consent/domain/effective-consent";

export type TotalFacePackageStatus = "active" | "completed" | "archived";
export type PackageReadinessStatus = "READY" | "PARTIALLY_READY" | "BLOCKED" | "COMPLETED";
export type CycleReadinessStatus = "READY" | "PARTIALLY_READY" | "BLOCKED" | "COMPLETED";

export const TOTAL_FACE_SUPPORTED_ZONES = ["brows", "eyes", "lips"] as const;
export type TotalFaceZoneCode = typeof TOTAL_FACE_SUPPORTED_ZONES[number];

export interface CycleReadinessSummary {
  cycleId: string;
  zoneCode: string;
  kind: string;
  stage: string;
  stageTitle?: string;
  medicalStatus: EffectiveMedicalEligibilityStatus;
  medicalReasonCode?: EffectiveMedicalEligibilityReasonCode | string;
  consentStatus: EffectiveConsentStatus;
  nextAppointment: {
    id: string;
    startAt: string;
    endAt: string;
    status: string;
    masterName?: string;
  } | null;
  procedures: {
    activeSessionId?: string | null;
    completedCount: number;
  };
  financial: {
    expectedPriceCents: number;
    paidCents: number;
    outstandingCents: number;
  };
  readiness: CycleReadinessStatus;
  signals: {
    needsMedical: boolean;
    needsConsent: boolean;
    needsAppointment: boolean;
    inProgress: boolean;
    isComplete: boolean;
  };
}

export interface PackageFinancialBreakdown {
  cycleId: string;
  zoneCode: string;
  expectedPriceCents: number;
  paidCents: number;
  refundsCents: number;
  outstandingCents: number;
}

export interface PackageFinancialSummary {
  expectedTotalCents: number;
  paidCents: number;
  refundsCents: number;
  outstandingCents: number;
  balanceCents: number;
  cycleBreakdown: PackageFinancialBreakdown[];
}

export interface PackageReadinessAggregate {
  packageId: string;
  clientId: string;
  kind: "total_face";
  status: TotalFacePackageStatus;
  overallReadiness: PackageReadinessStatus;
  completedCyclesCount: number;
  totalCyclesCount: number;
  cycles: CycleReadinessSummary[];
  financialSummary: PackageFinancialSummary;
  canComplete: boolean;
}
