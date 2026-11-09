import type {
  CycleReadinessStatus,
  CycleReadinessSummary,
  PackageFinancialSummary,
  PackageReadinessAggregate,
  PackageReadinessStatus,
  TotalFacePackageStatus,
} from "./types";
import type { EffectiveMedicalEligibilityStatus, EffectiveMedicalEligibilityReasonCode } from "@/features/medical/domain/effective-eligibility";
import type { EffectiveConsentStatus } from "@/features/consent/domain/effective-consent";

export function evaluateCycleReadiness(params: {
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
  activeSessionId?: string | null;
  completedProceduresCount: number;
  expectedPriceCents: number;
  paidCents: number;
}): CycleReadinessSummary {
  const isComplete = params.stage === "cycle_completed";
  const outstandingCents = Math.max(0, params.expectedPriceCents - params.paidCents);

  let readiness: CycleReadinessStatus;
  if (isComplete) {
    readiness = "COMPLETED";
  } else if (params.medicalStatus === "NOT_CLEARED") {
    readiness = "BLOCKED";
  } else if (
    params.medicalStatus === "CLEARED" &&
    params.consentStatus === "COVERED" &&
    params.nextAppointment !== null
  ) {
    readiness = "READY";
  } else {
    readiness = "PARTIALLY_READY";
  }

  const signals = {
    needsMedical: params.medicalStatus !== "CLEARED" && !isComplete,
    needsConsent: params.consentStatus !== "COVERED" && !isComplete,
    needsAppointment: !params.nextAppointment && !isComplete,
    inProgress: Boolean(params.activeSessionId),
    isComplete,
  };

  return {
    cycleId: params.cycleId,
    zoneCode: params.zoneCode,
    kind: params.kind,
    stage: params.stage,
    stageTitle: params.stageTitle,
    medicalStatus: params.medicalStatus,
    medicalReasonCode: params.medicalReasonCode,
    consentStatus: params.consentStatus,
    nextAppointment: params.nextAppointment,
    procedures: {
      activeSessionId: params.activeSessionId ?? null,
      completedCount: params.completedProceduresCount,
    },
    financial: {
      expectedPriceCents: params.expectedPriceCents,
      paidCents: params.paidCents,
      outstandingCents,
    },
    readiness,
    signals,
  };
}

export function evaluatePackageReadiness(params: {
  packageId: string;
  clientId: string;
  status: TotalFacePackageStatus;
  cycles: CycleReadinessSummary[];
  financialSummary: PackageFinancialSummary;
}): PackageReadinessAggregate {
  const totalCyclesCount = params.cycles.length;
  const completedCyclesCount = params.cycles.filter(c => c.signals.isComplete).length;
  const allCompleted = totalCyclesCount > 0 && completedCyclesCount === totalCyclesCount;

  let overallReadiness: PackageReadinessStatus;
  if (params.status === "completed" || params.status === "archived" || allCompleted) {
    overallReadiness = "COMPLETED";
  } else if (params.cycles.some(c => c.readiness === "BLOCKED")) {
    overallReadiness = "BLOCKED";
  } else if (params.cycles.length > 0 && params.cycles.every(c => c.readiness === "READY" || c.readiness === "COMPLETED")) {
    overallReadiness = "READY";
  } else {
    overallReadiness = "PARTIALLY_READY";
  }

  const canComplete = allCompleted && params.status === "active";

  return {
    packageId: params.packageId,
    clientId: params.clientId,
    kind: "total_face",
    status: params.status,
    overallReadiness,
    completedCyclesCount,
    totalCyclesCount,
    cycles: params.cycles,
    financialSummary: params.financialSummary,
    canComplete,
  };
}
