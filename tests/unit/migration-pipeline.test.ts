import { describe, it, expect } from "vitest";
import {
  computeSourceChecksum,
  redactSensitivePii,
} from "@/features/migration/staging/parser";
import { normalizeLegacyClient } from "@/features/migration/mapping/client-mapping";
import {
  mapLegacyCycleStage,
  normalizeLegacyCycle,
  expandTotalFacePackage,
} from "@/features/migration/mapping/cycle-mapping";
import { resolveStaffMapping, resolveServiceMapping } from "@/features/migration/mapping/staff-service-mapping";
import {
  parseLegacyTimestamp,
  detectAppointmentConflicts,
} from "@/features/migration/mapping/appointment-mapping";
import {
  normalizeLegacyMedicalProfile,
  normalizeLegacyMedicalClearance,
  normalizeLegacyConsent,
} from "@/features/migration/mapping/medical-consent-mapping";
import {
  normalizeLegacyFinance,
  computeFinancialReconciliation,
} from "@/features/migration/mapping/finance-mapping";
import { MigrationEngine } from "@/features/migration/engine/migration-engine";
import {
  createCleanLegacyDataset,
  createFinancialMismatchDataset,
  createMissingSignedConsentMediaDataset,
  createAppointmentFutureConflictDataset,
} from "@/features/migration/fixtures/representative-datasets";
import type { MigrationConfiguration } from "@/features/migration/types";

describe("Phase 19 Migration Pipeline Unit Tests", () => {
  const defaultStaffMappings = {
    "staff-1": { legacyStaffIdOrName: "staff-1", targetMasterId: "master-uuid-1", status: "MAPPED" as const },
    "Anna Master": { legacyStaffIdOrName: "Anna Master", targetMasterId: "master-uuid-1", status: "MAPPED" as const },
  };

  const defaultServiceMappings = {
    "srv-brows": { legacyServiceNameOrCode: "srv-brows", catalogCode: "brows_pmu_primary", status: "MAPPED" as const },
    "srv-lips": { legacyServiceNameOrCode: "srv-lips", catalogCode: "lips_pmu_primary", status: "MAPPED" as const },
    "srv-remover": { legacyServiceNameOrCode: "srv-remover", catalogCode: "remover_session", status: "MAPPED" as const },
  };

  const sampleConfig: MigrationConfiguration = {
    sourceSystem: "legacy_crm",
    defaultTimezone: "Europe/Rome",
    studioId: "studio-1",
    actorUserId: "user-1",
    staffMappings: defaultStaffMappings,
    serviceMappings: defaultServiceMappings,
    currency: "EUR",
    dryRun: true,
  };

  describe("Parser, Checksum & Redaction", () => {
    it("computes deterministic SHA-256 checksum for source dataset", () => {
      const data = { a: 1, b: "test" };
      const checksum1 = computeSourceChecksum(data);
      const checksum2 = computeSourceChecksum(data);
      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64);
    });

    it("redacts sensitive emails and phone numbers in error logs", () => {
      const text = "Error with client john.doe@example.com and phone +39 333 1234567";
      const redacted = redactSensitivePii(text);
      expect(redacted).not.toContain("john.doe@example.com");
      expect(redacted).not.toContain("333 1234567");
      expect(redacted).toContain("jo***@example.com");
    });
  });

  describe("Client Migration & Deduplication", () => {
    it("normalizes client and preserves Unicode/Cyrillic characters", () => {
      const { normalized, findings } = normalizeLegacyClient({
        id: "c-1",
        firstName: "Ольга",
        lastName: "Смирнова",
        phone: "+7 999 123-45-67",
        email: "olga.smirnova@example.test",
        legacyStatus: "qualification",
      });

      expect(normalized.firstName).toBe("Ольга");
      expect(normalized.lastName).toBe("Смирнова");
      expect(normalized.phone).toBe("+79991234567");
      expect(findings.some((f) => f.code === "CLIENT_LEGACY_STATUS_NOT_WORKFLOW_TRUTH")).toBe(true);
    });

    it("detects high-confidence duplicates by exact phone or email match", () => {
      const existing = [
        {
          sourceId: "c-1",
          firstName: "Maria",
          lastName: "Rossi",
          fullName: "Maria Rossi",
          phone: "+39333111222",
          email: "maria.rossi@example.test",
          whatsapp: "+39333111222",
          instagram: null,
          birthDate: null,
          notes: null,
          tags: [],
          referralSource: null,
          legacyStatus: null,
          isAnonymized: false,
          deletedAt: null,
          createdAt: new Date(),
          rawPayload: {},
        },
      ];

      const { normalized, findings } = normalizeLegacyClient(
        {
          id: "c-2",
          firstName: "Maria",
          lastName: "Rossi Clone",
          phone: "+39 333 111 222",
        },
        existing
      );

      expect(normalized.duplicateConfidence).toBe("EXACT");
      expect(findings.some((f) => f.code === "CLIENT_EXACT_CONTACT_DUPLICATE")).toBe(true);
    });

    it("flags name-only similarity for manual review without auto-merging", () => {
      const existing = [
        {
          sourceId: "c-1",
          firstName: "Giulia",
          lastName: "Rossi",
          fullName: "Giulia Rossi",
          phone: "+39333000111",
          email: "giulia.rossi@example.test",
          whatsapp: null,
          instagram: null,
          birthDate: null,
          notes: null,
          tags: [],
          referralSource: null,
          legacyStatus: null,
          isAnonymized: false,
          deletedAt: null,
          createdAt: new Date(),
          rawPayload: {},
        },
      ];

      const { normalized, findings } = normalizeLegacyClient(
        {
          id: "c-2",
          firstName: "Giulya",
          lastName: "Rossi",
          phone: "+39 349 999 888", // Different phone
        },
        existing
      );

      expect(normalized.duplicateConfidence).toBeUndefined(); // NOT auto-merged
      expect(findings.some((f) => f.code === "CLIENT_NAME_ONLY_MATCH_MANUAL_REVIEW")).toBe(true);
    });

    it("preserves anonymized / deleted client state without restoring deleted PII", () => {
      const { normalized } = normalizeLegacyClient({
        id: "c-anon",
        firstName: "Deleted",
        lastName: "Client",
        phone: "+39 333 999 888",
        isAnonymized: true,
      });

      expect(normalized.isAnonymized).toBe(true);
      expect(normalized.phone).toBeNull();
      expect(normalized.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("TreatmentCycle Stage & Package Mapping", () => {
    it("maps deterministic legacy statuses to canonical stages", () => {
      expect(mapLegacyCycleStage("lead").stage).toBe("new_lead");
      expect(mapLegacyCycleStage("qualification").stage).toBe("qualification");
      expect(mapLegacyCycleStage("first_session_completed").stage).toBe("first_session_completed");
      expect(mapLegacyCycleStage("cycle_completed").stage).toBe("cycle_completed");
      expect(mapLegacyCycleStage("client_refused").stage).toBe("lost");
    });

    it("flags ambiguous legacy statuses (active, in_progress, vip) as MANUAL_REVIEW", () => {
      const resActive = mapLegacyCycleStage("active");
      expect(resActive.stage).toBeNull();
      expect(resActive.findings[0].code).toBe("CYCLE_STAGE_AMBIGUOUS_MANUAL_REVIEW");

      const resInProgress = mapLegacyCycleStage("in_progress");
      expect(resInProgress.stage).toBeNull();
      expect(resInProgress.findings[0].code).toBe("CYCLE_STAGE_AMBIGUOUS_MANUAL_REVIEW");

      const resVip = mapLegacyCycleStage("vip");
      expect(resVip.stage).toBeNull();
      expect(resVip.findings[0].code).toBe("CYCLE_STAGE_AMBIGUOUS_MANUAL_REVIEW");
    });

    it("requires explicit removal evidence for kind='remover'", () => {
      const clientMap = new Map([["c-1", "c-1"]]);
      const resWithoutEvidence = normalizeLegacyCycle(
        {
          id: "cy-rem-1",
          clientId: "c-1",
          zone: "brows",
          kind: "remover",
          legacyStatus: "qualification",
          notes: "regular PMU consultation",
        },
        { clientSourceIdToTargetId: clientMap }
      );

      expect(resWithoutEvidence.normalized).toBeNull();
      expect(resWithoutEvidence.findings.some((f) => f.code === "CYCLE_REMOVER_WITHOUT_EVIDENCE")).toBe(true);
    });

    it("expands Total Face package into independent sibling zone cycles without cross-consent inference", () => {
      const clientMap = new Map([["c-1", "c-1"]]);
      const { cycles, findings } = expandTotalFacePackage(
        {
          id: "pkg-1",
          clientId: "c-1",
          name: "Total Face Full",
          packageCode: "total_face_pkg",
          zones: ["brows", "eyes", "lips"],
        },
        { clientSourceIdToTargetId: clientMap }
      );

      expect(cycles).toHaveLength(3);
      expect(cycles.map((c) => c.zone)).toEqual(["brows", "eyes", "lips"]);
      expect(findings.some((f) => f.code === "TOTAL_FACE_PACKAGE_EXPANDED")).toBe(true);
    });
  });

  describe("Staff & Service Mapping", () => {
    it("resolves mapped staff and rejects unmapped staff with error", () => {
      const mapped = resolveStaffMapping("staff-1", defaultStaffMappings);
      expect(mapped.targetMasterId).toBe("master-uuid-1");
      expect(mapped.findings).toHaveLength(0);

      const unmapped = resolveStaffMapping("unknown-master", defaultStaffMappings);
      expect(unmapped.targetMasterId).toBeUndefined();
      expect(unmapped.findings.some((f) => f.code === "STAFF_UNMAPPED_MANUAL_REVIEW")).toBe(true);
    });

    it("resolves mapped service and rejects unmapped service with error", () => {
      const mapped = resolveServiceMapping("srv-brows", defaultServiceMappings);
      expect(mapped.catalogCode).toBe("brows_pmu_primary");

      const unmapped = resolveServiceMapping("unknown-brows-variant-123", defaultServiceMappings);
      expect(unmapped.catalogCode).toBeUndefined();
      expect(unmapped.findings.some((f) => f.code === "SERVICE_UNMAPPED_MANUAL_REVIEW")).toBe(true);
    });
  });

  describe("Appointment Mapping & Conflict Detection", () => {
    it("parses local timestamps accurately without UTC shift", () => {
      const dt = parseLegacyTimestamp("2026-05-10 14:00:00", "Europe/Rome");
      expect(dt).toBeInstanceOf(Date);
      expect(!isNaN(dt.getTime())).toBe(true);
    });

    it("flags future overlapping appointments for same master as BLOCKER", () => {
      const future1 = new Date(Date.now() + 86400000 * 5);
      const future2 = new Date(future1.getTime() + 1800000); // 30 mins later

      const apps = [
        {
          sourceId: "app-1",
          clientId: "c-1",
          masterId: "master-1",
          serviceId: "srv-1",
          catalogCode: "brows_pmu_primary",
          startTime: future1,
          endTime: new Date(future1.getTime() + 7200000), // 2 hours
          status: "confirmed" as const,
          notes: null,
          googleEventId: null,
          createdAt: new Date(),
          rawPayload: {},
          isFuture: true,
        },
        {
          sourceId: "app-2",
          clientId: "c-2",
          masterId: "master-1",
          serviceId: "srv-2",
          catalogCode: "lips_pmu_primary",
          startTime: future2,
          endTime: new Date(future2.getTime() + 7200000),
          status: "confirmed" as const,
          notes: null,
          googleEventId: null,
          createdAt: new Date(),
          rawPayload: {},
          isFuture: true,
        },
      ];

      const conflicts = detectAppointmentConflicts(apps);
      expect(conflicts.some((c) => c.code === "APPOINTMENT_FUTURE_CONFLICT_BLOCKER")).toBe(true);
    });

    it("preserves historical overlapping appointments as audit info", () => {
      const past1 = new Date("2024-01-10T10:00:00.000Z");
      const past2 = new Date("2024-01-10T10:30:00.000Z");

      const apps = [
        {
          sourceId: "app-past-1",
          clientId: "c-1",
          masterId: "master-1",
          serviceId: "srv-1",
          catalogCode: "brows_pmu_primary",
          startTime: past1,
          endTime: new Date("2024-01-10T12:00:00.000Z"),
          status: "completed" as const,
          notes: null,
          googleEventId: null,
          createdAt: new Date(),
          rawPayload: {},
          isFuture: false,
        },
        {
          sourceId: "app-past-2",
          clientId: "c-2",
          masterId: "master-1",
          serviceId: "srv-2",
          catalogCode: "lips_pmu_primary",
          startTime: past2,
          endTime: new Date("2024-01-10T12:30:00.000Z"),
          status: "completed" as const,
          notes: null,
          googleEventId: null,
          createdAt: new Date(),
          rawPayload: {},
          isFuture: false,
        },
      ];

      const conflicts = detectAppointmentConflicts(apps);
      expect(conflicts.some((c) => c.code === "APPOINTMENT_HISTORICAL_OVERLAP_PRESERVED")).toBe(true);
      expect(conflicts.every((c) => c.severity !== "BLOCKER")).toBe(true);
    });
  });

  describe("Medical Profile, Clearance & Consent", () => {
    const clientMap = new Map([["c-1", "c-1"]]);
    const staffMap = new Map([["staff-1", "master-1"]]);

    it("rejects unproven medical profile to prevent inferring contraindications", () => {
      const res = normalizeLegacyMedicalProfile(
        {
          clientId: "c-1",
          allergies: "unknown free text",
          sourceProven: false,
        },
        { clientSourceIdToTargetId: clientMap }
      );

      expect(res.normalized).toBeNull();
      expect(res.findings.some((f) => f.code === "MEDICAL_PROFILE_UNPROVEN_SOURCE_REJECTED")).toBe(true);
    });

    it("rejects ambiguous clearance decisions like 'green' or 'okay' without reviewer evidence", () => {
      const res = normalizeLegacyMedicalClearance(
        {
          clientId: "c-1",
          decision: "green",
          hasExplicitEvidence: false,
        },
        { clientSourceIdToTargetId: clientMap, staffSourceIdToTargetId: staffMap }
      );

      expect(res.normalized).toBeNull();
      expect(res.findings.some((f) => f.code === "MEDICAL_CLEARANCE_AMBIGUOUS_DECISION_MANUAL_REVIEW")).toBe(true);
    });

    it("stores boolean-only consent as legacy reference without creating canonical SIGNED consent", () => {
      const res = normalizeLegacyConsent(
        {
          id: "cons-bool",
          clientId: "c-1",
          hasSignedArtifact: false,
          legacyBooleanOnly: true,
        },
        { clientSourceIdToTargetId: clientMap }
      );

      expect(res.normalized?.isCanonicalSignedEvidence).toBe(false);
      expect(res.normalized?.isLegacyReferenceOnly).toBe(true);
      expect(res.findings.some((f) => f.code === "CONSENT_LEGACY_BOOLEAN_REFERENCE_ONLY")).toBe(true);
    });
  });

  describe("Finance Mapping & Reconciliation", () => {
    const clientMap = new Map([["c-1", "c-1"]]);
    const cycleMap = new Map();
    const appMap = new Map();

    it("flags non-EUR currency mismatch as BLOCKER", () => {
      const res = normalizeLegacyFinance(
        {
          id: "fin-usd",
          clientId: "c-1",
          type: "payment",
          amountMinor: 10000,
          currency: "USD",
          date: "2025-01-20T12:00:00.000Z",
        },
        {
          clientSourceIdToTargetId: clientMap,
          appointmentSourceIdToTargetId: appMap,
          cycleSourceIdToTargetId: cycleMap,
          authoritativeCurrency: "EUR",
        }
      );

      expect(res.normalized).toBeNull();
      expect(res.findings.some((f) => f.code === "FINANCE_CURRENCY_MISMATCH_BLOCKER")).toBe(true);
    });

    it("reconciles exact matching balances and flags financial discrepancy as BLOCKER", () => {
      const rawFinances = [
        { id: "f1", clientId: "c-1", type: "charge" as const, amountMinor: 35000, currency: "EUR", date: "2025-01-20" },
        { id: "f2", clientId: "c-1", type: "payment" as const, amountMinor: 20000, currency: "EUR", date: "2025-01-20" },
      ];

      const normFinances = [
        { sourceId: "f1", clientId: "c-1", appointmentId: null, cycleId: null, type: "CHARGE" as const, amountMinor: 35000, currency: "EUR", date: new Date(), method: null, reference: null, notes: null, isOpeningBalanceAdjustment: false },
        { sourceId: "f2", clientId: "c-1", appointmentId: null, cycleId: null, type: "PAYMENT" as const, amountMinor: 35000, currency: "EUR", date: new Date(), method: null, reference: null, notes: null, isOpeningBalanceAdjustment: false },
      ];

      const { report, findings } = computeFinancialReconciliation(
        rawFinances,
        normFinances,
        new Map([["c-1", { fullName: "Test Client" }]]),
        "EUR"
      );

      expect(report.isReconciled).toBe(false);
      expect(report.studioDifferenceMinor).toBe(15000);
      expect(findings.some((f) => f.code === "FINANCIAL_RECONCILIATION_MISMATCH_BLOCKER")).toBe(true);
    });
  });

  describe("Full Staging Validation & Engine Dry-Run", () => {
    it("validates clean legacy dataset and reports READY FOR CUTOVER", async () => {
      const clean = createCleanLegacyDataset();
      const engine = new MigrationEngine();
      const summary = await engine.dryRun(clean, sampleConfig);

      expect(summary.status).toBe("DRY_RUN_PASSED");
      expect(summary.cutoverReadiness.ready).toBe(true);
      expect(summary.cutoverReadiness.blockers).toHaveLength(0);
      expect(summary.financialReconciliation.isReconciled).toBe(true);
    });

    it("blocks cutover when financial mismatch is present", async () => {
      const data = createFinancialMismatchDataset();
      const engine = new MigrationEngine();
      const summary = await engine.dryRun(data, sampleConfig);

      expect(summary.status).toBe("DRY_RUN_BLOCKED");
      expect(summary.cutoverReadiness.ready).toBe(false);
      expect(summary.findingCounts.BLOCKER).toBeGreaterThan(0);
    });

    it("blocks cutover when signed consent media file is missing", async () => {
      const data = createMissingSignedConsentMediaDataset();
      const engine = new MigrationEngine();
      const summary = await engine.dryRun(data, sampleConfig);

      expect(summary.status).toBe("DRY_RUN_BLOCKED");
      expect(summary.cutoverReadiness.ready).toBe(false);
      expect(summary.findings.some((f) => f.code === "MISSING_SIGNED_CONSENT_MEDIA_BLOCKER")).toBe(true);
    });

    it("blocks cutover when future appointment conflicts exist", async () => {
      const data = createAppointmentFutureConflictDataset();
      const engine = new MigrationEngine();
      const summary = await engine.dryRun(data, sampleConfig);

      expect(summary.status).toBe("DRY_RUN_BLOCKED");
      expect(summary.cutoverReadiness.ready).toBe(false);
      expect(summary.findings.some((f) => f.code === "APPOINTMENT_FUTURE_CONFLICT_BLOCKER")).toBe(true);
    });
  });
});
