import { describe, it, expect } from "vitest";
import {
  evaluateCycleReadiness,
  evaluatePackageReadiness,
} from "@/features/packages/domain/readiness";
import type { TotalFacePackageStatus } from "@/features/packages/domain/types";

describe("Package & Cycle Readiness Pure Evaluators", () => {
  describe("evaluateCycleReadiness", () => {
    it("evaluates a fully ready cycle", () => {
      const summary = evaluateCycleReadiness({
        cycleId: "c1",
        zoneCode: "brows",
        kind: "pmu",
        stage: "prep_procedure",
        stageTitle: "Подготовка",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: {
          id: "a1",
          startAt: "2026-10-10T10:00:00Z",
          endAt: "2026-10-10T12:00:00Z",
          status: "confirmed",
        },
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });

      expect(summary.readiness).toBe("READY");
      expect(summary.signals.needsMedical).toBe(false);
      expect(summary.signals.needsConsent).toBe(false);
      expect(summary.signals.needsAppointment).toBe(false);
      expect(summary.signals.isComplete).toBe(false);
    });

    it("evaluates a medical-blocked cycle as BLOCKED", () => {
      const summary = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "lips",
        kind: "pmu",
        stage: "consultation",
        medicalStatus: "NOT_CLEARED",
        medicalReasonCode: "PREGNANCY_ABSOLUTE",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 0,
        expectedPriceCents: 12000,
        paidCents: 0,
      });

      expect(summary.readiness).toBe("BLOCKED");
      expect(summary.signals.needsMedical).toBe(true);
    });

    it("evaluates a completed cycle as COMPLETED", () => {
      const summary = evaluateCycleReadiness({
        cycleId: "c3",
        zoneCode: "eyes",
        kind: "pmu",
        stage: "cycle_completed",
        stageTitle: "Завершен",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 1,
        expectedPriceCents: 15000,
        paidCents: 15000,
      });

      expect(summary.readiness).toBe("COMPLETED");
      expect(summary.signals.isComplete).toBe(true);
      expect(summary.signals.needsMedical).toBe(false);
      expect(summary.signals.needsConsent).toBe(false);
    });

    it("does not treat lost or refresh_no_response or archived as completed", () => {
      for (const stage of ["lost", "refresh_no_response", "archived"]) {
        const summary = evaluateCycleReadiness({
          cycleId: "c-term",
          zoneCode: "brows",
          kind: "pmu",
          stage,
          medicalStatus: "CLEARED",
          consentStatus: "COVERED",
          nextAppointment: null,
          completedProceduresCount: 0,
          expectedPriceCents: 10000,
          paidCents: 0,
        });

        expect(summary.signals.isComplete).toBe(false);
        expect(summary.readiness).not.toBe("COMPLETED");
      }
    });

    it("evaluates missing consent or appointment as PARTIALLY_READY", () => {
      const summary = evaluateCycleReadiness({
        cycleId: "c4",
        zoneCode: "brows",
        kind: "pmu",
        stage: "new_lead",
        medicalStatus: "CLEARED",
        consentStatus: "CONSENT_REQUIRED",
        nextAppointment: null,
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 0,
      });

      expect(summary.readiness).toBe("PARTIALLY_READY");
      expect(summary.signals.needsConsent).toBe(true);
      expect(summary.signals.needsAppointment).toBe(true);
    });
  });

  describe("evaluatePackageReadiness", () => {
    const dummyFinancial = {
      expectedTotalCents: 30000,
      paidCents: 30000,
      refundsCents: 0,
      outstandingCents: 0,
      balanceCents: 30000,
      cycleBreakdown: [],
    };

    it("evaluates overall package as READY when all active cycles are ready", () => {
      const cycle1 = evaluateCycleReadiness({
        cycleId: "c1",
        zoneCode: "brows",
        kind: "pmu",
        stage: "prep_procedure",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: { id: "a1", startAt: "2026-10-10", endAt: "2026-10-10", status: "confirmed" },
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });
      const cycle2 = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "eyes",
        kind: "pmu",
        stage: "prep_procedure",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: { id: "a2", startAt: "2026-10-10", endAt: "2026-10-10", status: "confirmed" },
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });

      const agg = evaluatePackageReadiness({
        packageId: "pkg-1",
        clientId: "cl-1",
        status: "active" as TotalFacePackageStatus,
        cycles: [cycle1, cycle2],
        financialSummary: dummyFinancial,
      });

      expect(agg.overallReadiness).toBe("READY");
      expect(agg.canComplete).toBe(false);
    });

    it("evaluates overall package as BLOCKED if any cycle is blocked", () => {
      const cycle1 = evaluateCycleReadiness({
        cycleId: "c1",
        zoneCode: "brows",
        kind: "pmu",
        stage: "prep_procedure",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: { id: "a1", startAt: "2026-10-10", endAt: "2026-10-10", status: "confirmed" },
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });
      const cycle2 = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "lips",
        kind: "pmu",
        stage: "consultation",
        medicalStatus: "NOT_CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 0,
      });

      const agg = evaluatePackageReadiness({
        packageId: "pkg-1",
        clientId: "cl-1",
        status: "active" as TotalFacePackageStatus,
        cycles: [cycle1, cycle2],
        financialSummary: dummyFinancial,
      });

      expect(agg.overallReadiness).toBe("BLOCKED");
    });

    it("evaluates canComplete = true only when all sibling cycles are complete", () => {
      const cycle1 = evaluateCycleReadiness({
        cycleId: "c1",
        zoneCode: "brows",
        kind: "pmu",
        stage: "cycle_completed",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 1,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });
      const cycle2 = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "eyes",
        kind: "pmu",
        stage: "cycle_completed",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 1,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });

      const agg = evaluatePackageReadiness({
        packageId: "pkg-1",
        clientId: "cl-1",
        status: "active" as TotalFacePackageStatus,
        cycles: [cycle1, cycle2],
        financialSummary: dummyFinancial,
      });

      expect(agg.overallReadiness).toBe("COMPLETED");
      expect(agg.completedCyclesCount).toBe(2);
      expect(agg.totalCyclesCount).toBe(2);
      expect(agg.canComplete).toBe(true);
    });

    it("evaluates canComplete = false if one sibling is lost or refresh_no_response", () => {
      const cycle1 = evaluateCycleReadiness({
        cycleId: "c1",
        zoneCode: "brows",
        kind: "pmu",
        stage: "cycle_completed",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 1,
        expectedPriceCents: 10000,
        paidCents: 10000,
      });
      const cycle2Lost = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "eyes",
        kind: "pmu",
        stage: "lost",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 0,
      });

      const aggLost = evaluatePackageReadiness({
        packageId: "pkg-1",
        clientId: "cl-1",
        status: "active" as TotalFacePackageStatus,
        cycles: [cycle1, cycle2Lost],
        financialSummary: dummyFinancial,
      });

      expect(aggLost.canComplete).toBe(false);
      expect(aggLost.completedCyclesCount).toBe(1);
      expect(aggLost.overallReadiness).toBe("PARTIALLY_READY");

      const cycle2RefreshNoResp = evaluateCycleReadiness({
        cycleId: "c2",
        zoneCode: "eyes",
        kind: "pmu",
        stage: "refresh_no_response",
        medicalStatus: "CLEARED",
        consentStatus: "COVERED",
        nextAppointment: null,
        completedProceduresCount: 0,
        expectedPriceCents: 10000,
        paidCents: 0,
      });

      const aggRefresh = evaluatePackageReadiness({
        packageId: "pkg-1",
        clientId: "cl-1",
        status: "active" as TotalFacePackageStatus,
        cycles: [cycle1, cycle2RefreshNoResp],
        financialSummary: dummyFinancial,
      });

      expect(aggRefresh.canComplete).toBe(false);
      expect(aggRefresh.completedCyclesCount).toBe(1);
      expect(aggRefresh.overallReadiness).toBe("PARTIALLY_READY");
    });
  });
});
