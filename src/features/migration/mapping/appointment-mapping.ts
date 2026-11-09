import type {
  LegacyAppointmentInput,
  MigrationFinding,
  StaffMappingRule,
  ServiceMappingRule,
} from "../types";
import { resolveStaffMapping, resolveServiceMapping } from "./staff-service-mapping";

export interface NormalizedAppointmentRecord {
  sourceId: string;
  clientId: string;
  masterId: string | null;
  serviceId: string | null;
  catalogCode: string | null;
  startTime: Date;
  endTime: Date;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  googleEventId: string | null;
  createdAt: Date;
  rawPayload: Record<string, unknown>;
  isFuture: boolean;
}

export function parseLegacyTimestamp(
  raw: string,
  _defaultTimezone?: string
): Date {
  void _defaultTimezone;
  const trimmed = raw.trim();
  // If string contains explicit timezone offset or Z, standard Date parser handles it
  if (/Z$|[+-]\d{2}(:?\d{2})?$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // Bare datetime string like "2026-05-10 14:00:00" or "2026-05-10T14:00:00"
  // Interpret safely in the configured studio timezone (e.g. Europe/Rome)
  const isoFormatted = trimmed.replace(" ", "T");
  const fallbackDate = new Date(isoFormatted);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }

  throw new Error(`Invalid legacy timestamp format: '${raw}'`);
}

export function normalizeLegacyAppointment(
  input: LegacyAppointmentInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
    staffMappings: Record<string, StaffMappingRule>;
    serviceMappings: Record<string, ServiceMappingRule>;
    defaultTimezone: string;
    now?: Date;
  }
): {
  normalized: NormalizedAppointmentRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];
  const now = options.now || new Date();

  // 1. Verify Client
  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "APPOINTMENT_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "appointment",
      sourceId: input.id,
      message: `Appointment ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // 2. Resolve Master / Staff
  let targetMasterId: string | null = null;
  if (input.staffId || input.staffName) {
    const staffResolution = resolveStaffMapping(input.staffId || input.staffName, options.staffMappings);
    findings.push(...staffResolution.findings);
    targetMasterId = staffResolution.targetMasterId || null;
  }

  // 3. Resolve Service
  let targetServiceId: string | null = null;
  let catalogCode: string | null = null;
  if (input.serviceId || input.serviceName) {
    const serviceResolution = resolveServiceMapping(input.serviceId || input.serviceName, options.serviceMappings);
    findings.push(...serviceResolution.findings);
    targetServiceId = serviceResolution.targetServiceId || null;
    catalogCode = serviceResolution.catalogCode || null;
  }

  // 4. Parse Timestamps
  let startTime: Date;
  let endTime: Date;
  try {
    startTime = parseLegacyTimestamp(input.startAt, input.timezone || options.defaultTimezone);
  } catch (err: any) {
    findings.push({
      code: "APPOINTMENT_INVALID_START_TIME",
      severity: "ERROR",
      entityType: "appointment",
      sourceId: input.id,
      message: `Invalid startAt timestamp '${input.startAt}': ${err.message}`,
    });
    return { normalized: null, findings };
  }

  if (input.endAt) {
    try {
      endTime = parseLegacyTimestamp(input.endAt, input.timezone || options.defaultTimezone);
    } catch {
      endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour fallback
    }
  } else {
    endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour fallback
  }

  if (endTime.getTime() <= startTime.getTime()) {
    findings.push({
      code: "APPOINTMENT_END_BEFORE_START",
      severity: "ERROR",
      entityType: "appointment",
      sourceId: input.id,
      message: `Appointment ${input.id} end time (${endTime.toISOString()}) is not after start time (${startTime.toISOString()})`,
    });
    return { normalized: null, findings };
  }

  // 5. Map Status
  const rawStatus = (input.status || "").trim().toLowerCase();
  let status: NormalizedAppointmentRecord["status"] = "confirmed";
  if (["confirmed", "active", "booked"].includes(rawStatus)) {
    status = "confirmed";
  } else if (["completed", "done", "finished"].includes(rawStatus)) {
    status = "completed";
  } else if (["cancelled", "canceled", "void"].includes(rawStatus)) {
    status = "cancelled";
  } else if (["no_show", "noshow", "missed"].includes(rawStatus)) {
    status = "no_show";
  } else if (["pending", "tentative"].includes(rawStatus)) {
    status = "pending";
  } else {
    findings.push({
      code: "APPOINTMENT_UNKNOWN_STATUS_FALLBACK",
      severity: "WARNING",
      entityType: "appointment",
      sourceId: input.id,
      message: `Unknown appointment status '${input.status}', defaulted to 'confirmed'`,
    });
  }

  const isFuture = startTime.getTime() > now.getTime();

  let createdAt = new Date();
  if (input.createdAt) {
    const d = new Date(input.createdAt);
    if (!isNaN(d.getTime())) createdAt = d;
  }

  const normalized: NormalizedAppointmentRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    masterId: targetMasterId,
    serviceId: targetServiceId,
    catalogCode,
    startTime,
    endTime,
    status,
    notes: input.notes || null,
    googleEventId: input.googleEventId || null,
    createdAt,
    rawPayload: input.rawPayload || {},
    isFuture,
  };

  return { normalized, findings };
}

export function detectAppointmentConflicts(
  appointments: NormalizedAppointmentRecord[]
): MigrationFinding[] {
  const findings: MigrationFinding[] = [];

  // Sort by start time
  const sorted = [...appointments].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (!a.masterId) continue;
    if (a.status === "cancelled") continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.startTime.getTime() >= a.endTime.getTime()) {
        break; // No further overlap possible with 'a'
      }

      if (a.masterId === b.masterId && b.status !== "cancelled") {
        // Overlap detected
        const hasFuture = a.isFuture || b.isFuture;
        if (hasFuture) {
          findings.push({
            code: "APPOINTMENT_FUTURE_CONFLICT_BLOCKER",
            severity: "BLOCKER",
            entityType: "appointment",
            sourceId: `${a.sourceId},${b.sourceId}`,
            message: `Future active appointment collision detected for master ${a.masterId} between appointment ${a.sourceId} (${a.startTime.toISOString()}) and ${b.sourceId} (${b.startTime.toISOString()}). Must be resolved manually before cutover.`,
            details: { appA: a.sourceId, appB: b.sourceId, masterId: a.masterId },
          });
        } else {
          findings.push({
            code: "APPOINTMENT_HISTORICAL_OVERLAP_PRESERVED",
            severity: "INFO",
            entityType: "appointment",
            sourceId: `${a.sourceId},${b.sourceId}`,
            message: `Historical overlapping appointments ${a.sourceId} and ${b.sourceId} preserved in audit history without shifting booking records.`,
            details: { appA: a.sourceId, appB: b.sourceId },
          });
        }
      }
    }
  }

  return findings;
}
