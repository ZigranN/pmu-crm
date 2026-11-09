import type { CycleStage, CycleKind, CycleZone } from "../types";
import type {
  LegacyCycleInput,
  CycleStageMappingRule,
  MigrationFinding,
  LegacyPackageInput,
} from "../types";

export const CANONICAL_CYCLE_STAGE_RULES: Record<string, CycleStageMappingRule> = {
  // Deterministic HIGH confidence mappings
  new_lead: { legacyValue: "new_lead", canonicalStage: "new_lead", confidence: "HIGH", reason: "Exact match for initial lead entry" },
  lead: { legacyValue: "lead", canonicalStage: "new_lead", confidence: "HIGH", reason: "Direct synonym for new lead entry" },
  qualification: { legacyValue: "qualification", canonicalStage: "qualification", confidence: "HIGH", reason: "Exact match for qualification stage" },
  qualifying: { legacyValue: "qualifying", canonicalStage: "qualification", confidence: "HIGH", reason: "Direct synonym for qualification stage" },
  consultation_needed: { legacyValue: "consultation_needed", canonicalStage: "consultation_needed", confidence: "HIGH", reason: "Exact match for consultation requirement" },
  consultation_scheduled: { legacyValue: "consultation_scheduled", canonicalStage: "consultation_scheduled", confidence: "HIGH", reason: "Exact match for scheduled consultation" },
  consultation_completed: { legacyValue: "consultation_completed", canonicalStage: "consultation_completed", confidence: "HIGH", reason: "Exact match for finished consultation" },
  procedure_confirmed: { legacyValue: "procedure_confirmed", canonicalStage: "procedure_confirmed", confidence: "HIGH", reason: "Exact match for confirmed procedure" },
  first_session_completed: { legacyValue: "first_session_completed", canonicalStage: "first_session_completed", confidence: "HIGH", reason: "Exact match for primary session completion" },
  session_1_done: { legacyValue: "session_1_done", canonicalStage: "first_session_completed", confidence: "HIGH", reason: "Direct synonym for primary session completion" },
  second_session_completed: { legacyValue: "second_session_completed", canonicalStage: "second_session_completed", confidence: "HIGH", reason: "Exact match for second session completion" },
  session_2_done: { legacyValue: "session_2_done", canonicalStage: "second_session_completed", confidence: "HIGH", reason: "Direct synonym for second session completion" },
  cycle_completed: { legacyValue: "cycle_completed", canonicalStage: "cycle_completed", confidence: "HIGH", reason: "Exact match for completed treatment cycle" },
  treatment_finished: { legacyValue: "treatment_finished", canonicalStage: "cycle_completed", confidence: "HIGH", reason: "Direct synonym for completed treatment cycle" },
  lost: { legacyValue: "lost", canonicalStage: "lost", confidence: "HIGH", reason: "Exact match for lost client/cycle" },
  client_refused: { legacyValue: "client_refused", canonicalStage: "lost", confidence: "HIGH", reason: "Direct synonym for lost cycle" },

  // Ambiguous mappings requiring MANUAL_REVIEW - DO NOT INVENT CANONICAL STAGE
  active: { legacyValue: "active", canonicalStage: null, confidence: "AMBIGUOUS", reason: "Generic 'active' status lacks lifecycle milestone evidence; requires manual review" },
  in_progress: { legacyValue: "in_progress", canonicalStage: null, confidence: "AMBIGUOUS", reason: "Generic 'in_progress' status is ambiguous across consultation, primary session, or touch-up" },
  followup: { legacyValue: "followup", canonicalStage: null, confidence: "AMBIGUOUS", reason: "'followup' could be healing check, second session scheduling, or refresh offer" },
  waiting: { legacyValue: "waiting", canonicalStage: null, confidence: "AMBIGUOUS", reason: "'waiting' lacks procedure or consultation context" },
  vip: { legacyValue: "vip", canonicalStage: null, confidence: "NONE", reason: "'vip' is a client tag, not a treatment lifecycle stage" },
  archive: { legacyValue: "archive", canonicalStage: null, confidence: "AMBIGUOUS", reason: "'archive' does not differentiate completed from abandoned treatments" },
  done: { legacyValue: "done", canonicalStage: null, confidence: "AMBIGUOUS", reason: "Unqualified 'done' status lacks explicit procedure evidence" },
};

export interface NormalizedCycleRecord {
  sourceId: string;
  clientId: string;
  zone: CycleZone;
  kind: CycleKind;
  stage: CycleStage;
  serviceId: string | null;
  assignedMasterId: string | null;
  packageId: string | null;
  originCycleId: string | null;
  legacyStatus: string | null;
  createdAt: Date;
  rawPayload: Record<string, unknown>;
}

export function mapLegacyCycleStage(legacyStatus: string | null | undefined): {
  stage: CycleStage | null;
  rule: CycleStageMappingRule;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];
  if (!legacyStatus) {
    const fallbackRule: CycleStageMappingRule = {
      legacyValue: "",
      canonicalStage: "new_lead",
      confidence: "HIGH",
      reason: "Default initial stage when no legacy status was recorded",
    };
    return { stage: "new_lead", rule: fallbackRule, findings };
  }

  const normalizedKey = legacyStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const rule = CANONICAL_CYCLE_STAGE_RULES[normalizedKey];

  if (!rule) {
    const unknownRule: CycleStageMappingRule = {
      legacyValue: legacyStatus,
      canonicalStage: null,
      confidence: "NONE",
      reason: `Unknown legacy cycle status '${legacyStatus}'`,
    };
    findings.push({
      code: "CYCLE_STAGE_UNKNOWN_MANUAL_REVIEW",
      severity: "WARNING",
      entityType: "treatment_cycle",
      message: `Legacy status '${legacyStatus}' cannot be mapped deterministically to canonical TreatmentCycle stage. Flagged for manual review.`,
      details: { legacyStatus },
    });
    return { stage: null, rule: unknownRule, findings };
  }

  if (rule.confidence !== "HIGH" || rule.canonicalStage === null) {
    findings.push({
      code: "CYCLE_STAGE_AMBIGUOUS_MANUAL_REVIEW",
      severity: "WARNING",
      entityType: "treatment_cycle",
      message: `Legacy status '${legacyStatus}' is ambiguous: ${rule.reason}. Manual review required before assigning canonical stage.`,
      details: { legacyStatus, rule },
    });
    return { stage: null, rule, findings };
  }

  return { stage: rule.canonicalStage, rule, findings };
}

export function normalizeLegacyCycle(
  input: LegacyCycleInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedCycleRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  // Verify client mapping exists
  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "CYCLE_UNRESOLVED_CLIENT_REFERENCE",
      severity: "ERROR",
      entityType: "treatment_cycle",
      sourceId: input.id,
      message: `TreatmentCycle ${input.id} references client ${input.clientId} which is not mapped or resolved`,
    });
    return { normalized: null, findings };
  }

  // Validate zone
  const validZones: CycleZone[] = ["brows", "eyes", "lips", "lashes", "skin"];
  const rawZone = (input.zone || "").trim().toLowerCase();
  const zone = validZones.find((z) => z === rawZone);
  if (!zone) {
    findings.push({
      code: "CYCLE_INVALID_OR_MISSING_ZONE",
      severity: "ERROR",
      entityType: "treatment_cycle",
      sourceId: input.id,
      message: `TreatmentCycle ${input.id} has invalid or missing zone '${input.zone}'. Canonical PMU cycles must specify a valid zone (brows, eyes, lips, lashes, skin).`,
    });
    return { normalized: null, findings };
  }

  // Validate kind
  let kind: CycleKind = "pmu";
  if (input.kind) {
    const rawKind = input.kind.trim().toLowerCase();
    if (["pmu", "refresh", "remover", "paid_correction", "free_correction", "non_pmu"].includes(rawKind)) {
      kind = rawKind as CycleKind;
    } else {
      findings.push({
        code: "CYCLE_UNKNOWN_KIND_FALLBACK",
        severity: "WARNING",
        entityType: "treatment_cycle",
        sourceId: input.id,
        message: `Unknown cycle kind '${input.kind}', defaulting to 'pmu'`,
      });
    }
  }

  // Remover verification rule: Only import kind='remover' when source clearly identifies removal treatment
  if (kind === "remover") {
    const hasRemovalNotes = input.notes && (input.notes.toLowerCase().includes("remover") || input.notes.toLowerCase().includes("removal") || input.notes.toLowerCase().includes("laser"));
    const hasRemovalService = input.serviceId && input.serviceId.toLowerCase().includes("remover");
    const hasRemovalRaw = input.rawPayload && JSON.stringify(input.rawPayload).toLowerCase().includes("remover");

    if (input.notes && !hasRemovalNotes && !hasRemovalService && !hasRemovalRaw) {
      findings.push({
        code: "CYCLE_REMOVER_WITHOUT_EVIDENCE",
        severity: "ERROR",
        entityType: "treatment_cycle",
        sourceId: input.id,
        message: `TreatmentCycle ${input.id} marked as remover without clear source evidence`,
      });
      return { normalized: null, findings };
    }
  }

  // Stage mapping
  const { stage, findings: stageFindings } = mapLegacyCycleStage(input.legacyStatus);
  findings.push(...stageFindings);

  if (!stage) {
    // Cannot deterministically auto-import cycle with ambiguous or unknown stage without manual review
    findings.push({
      code: "CYCLE_BLOCKED_UNRESOLVED_STAGE",
      severity: "WARNING",
      entityType: "treatment_cycle",
      sourceId: input.id,
      message: `TreatmentCycle ${input.id} cannot be automatically created because stage mapping for '${input.legacyStatus}' requires manual review`,
    });
    return { normalized: null, findings };
  }

  let createdAt = new Date();
  if (input.startDate) {
    const d = new Date(input.startDate);
    if (!isNaN(d.getTime())) createdAt = d;
  }

  const normalized: NormalizedCycleRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    zone,
    kind,
    stage,
    serviceId: input.serviceId || null,
    assignedMasterId: input.staffId || null,
    packageId: input.packageId || null,
    originCycleId: input.originCycleId || null,
    legacyStatus: input.legacyStatus || null,
    createdAt,
    rawPayload: input.rawPayload || {},
  };

  return { normalized, findings };
}

export function expandTotalFacePackage(
  pkg: LegacyPackageInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
  }
): {
  cycles: NormalizedCycleRecord[];
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];
  const cycles: NormalizedCycleRecord[] = [];

  if (!options.clientSourceIdToTargetId.has(pkg.clientId)) {
    findings.push({
      code: "PACKAGE_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "package",
      sourceId: pkg.id,
      message: `Package ${pkg.id} references unresolved client ${pkg.clientId}`,
    });
    return { cycles, findings };
  }

  const zones = Array.isArray(pkg.zones) ? pkg.zones : ["brows", "eyes", "lips"];
  const validZones: CycleZone[] = ["brows", "eyes", "lips"];

  let createdAt = new Date();
  if (pkg.createdAt) {
    const d = new Date(pkg.createdAt);
    if (!isNaN(d.getTime())) createdAt = d;
  }

  for (const rawZone of zones) {
    const zone = validZones.find((z) => z === rawZone.trim().toLowerCase());
    if (!zone) {
      findings.push({
        code: "PACKAGE_INVALID_ZONE",
        severity: "WARNING",
        entityType: "package",
        sourceId: pkg.id,
        message: `Package ${pkg.id} contains non-standard zone '${rawZone}', skipped sibling cycle`,
      });
      continue;
    }

    cycles.push({
      sourceId: `${pkg.id}_${zone}`,
      clientId: pkg.clientId,
      zone,
      kind: "pmu",
      stage: "new_lead",
      serviceId: null,
      assignedMasterId: null,
      packageId: pkg.id,
      originCycleId: null,
      legacyStatus: "package_member",
      createdAt,
      rawPayload: { packageId: pkg.id, packageName: pkg.name },
    });
  }

  findings.push({
    code: "TOTAL_FACE_PACKAGE_EXPANDED",
    severity: "INFO",
    entityType: "package",
    sourceId: pkg.id,
    message: `Expanded package '${pkg.name}' into ${cycles.length} independent sibling zone cycles with independent stages and without cross-zone consent inference.`,
  });

  return { cycles, findings };
}
