import type {
  LegacyProcedureInput,
  MigrationFinding,
  StaffMappingRule,
} from "../types";
import { resolveStaffMapping } from "./staff-service-mapping";

export interface NormalizedProcedureRecord {
  sourceId: string;
  clientId: string;
  appointmentId: string | null;
  cycleId: string | null;
  masterId: string | null;
  zone: string;
  procedureArea: string;
  sessionType: "first_session" | "second_session" | "refresh" | "correction" | "touchup";
  status: "completed" | "in_progress" | "draft" | "cancelled" | "no_show";
  executedAt: Date;
  pigmentMix: string | null;
  anesthesia: string | null;
  notes: string | null;
  rawPayload: Record<string, unknown>;
}

export function normalizeLegacyProcedure(
  input: LegacyProcedureInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
    appointmentSourceIdToTargetId: Map<string, string>;
    cycleSourceIdToTargetId: Map<string, string>;
    staffMappings: Record<string, StaffMappingRule>;
  }
): {
  normalized: NormalizedProcedureRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  // Client link
  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "PROCEDURE_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "procedure",
      sourceId: input.id,
      message: `Procedure ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // Master resolution
  let masterId: string | null = null;
  if (input.staffId) {
    const staffRes = resolveStaffMapping(input.staffId, options.staffMappings);
    findings.push(...staffRes.findings);
    masterId = staffRes.targetMasterId || null;
  }

  // Execution timestamp
  let executedAt = new Date();
  if (input.executedAt) {
    const d = new Date(input.executedAt);
    if (!isNaN(d.getTime())) executedAt = d;
  }

  // Map zone / area
  const rawZone = (input.zone || "").trim().toLowerCase();
  const validZones = ["brows", "eyes", "lips", "lashes", "skin"];
  const zone = validZones.includes(rawZone) ? rawZone : "brows";
  const procedureArea = input.procedureArea || zone;

  // Session type
  const rawSessionType = (input.sessionType || "").trim().toLowerCase();
  let sessionType: NormalizedProcedureRecord["sessionType"] = "first_session";
  if (["second_session", "session_2", "touchup", "correction"].includes(rawSessionType)) {
    sessionType = rawSessionType === "correction" ? "correction" : "second_session";
  } else if (["refresh", "annual_refresh"].includes(rawSessionType)) {
    sessionType = "refresh";
  }

  // Status mapping: Explicit status preservation (never blindly mark all as completed)
  const rawStatus = (input.status || "").trim().toLowerCase();
  let status: NormalizedProcedureRecord["status"] = "completed";
  if (["completed", "done", "finished"].includes(rawStatus)) {
    status = "completed";
  } else if (["in_progress", "started", "active"].includes(rawStatus)) {
    status = "in_progress";
  } else if (["cancelled", "void"].includes(rawStatus)) {
    status = "cancelled";
  } else if (["no_show", "noshow"].includes(rawStatus)) {
    status = "no_show";
  } else if (["draft", "template"].includes(rawStatus)) {
    status = "draft";
  } else {
    findings.push({
      code: "PROCEDURE_UNKNOWN_STATUS",
      severity: "WARNING",
      entityType: "procedure",
      sourceId: input.id,
      message: `Unknown procedure status '${input.status}', preserved as 'completed'`,
    });
  }

  const normalized: NormalizedProcedureRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    appointmentId: input.appointmentId ? (options.appointmentSourceIdToTargetId.get(input.appointmentId) || input.appointmentId) : null,
    cycleId: input.cycleId ? (options.cycleSourceIdToTargetId.get(input.cycleId) || input.cycleId) : null,
    masterId,
    zone,
    procedureArea,
    sessionType,
    status,
    executedAt,
    pigmentMix: input.pigmentMix || null,
    anesthesia: input.anesthesia || null,
    notes: input.notes || null,
    rawPayload: input.rawPayload || {},
  };

  return { normalized, findings };
}
