import { createHash } from "node:crypto";
import type { GoogleCalendarEvent, ReconciliationPolicyResult } from "./types";

export interface AppointmentSyncData {
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  clientName?: string | null;
  serviceName?: string | null;
  masterName?: string | null;
  notes?: string | null;
}

/**
 * Computes deterministic SHA-256 hash of appointment representation.
 * Used to avoid redundant writes to Google Calendar.
 */
export function computeAppointmentSyncHash(data: AppointmentSyncData): string {
  const startIso = new Date(data.startAt).toISOString();
  const endIso = new Date(data.endAt).toISOString();

  const normalized = JSON.stringify({
    id: data.id,
    start: startIso,
    end: endIso,
    status: data.status,
    client: data.clientName ?? "",
    service: data.serviceName ?? "",
    master: data.masterName ?? "",
  });

  return createHash("sha256").update(normalized).digest("hex");
}

export interface ReconcileEvaluationContext {
  crmAppointment: {
    id: string;
    startAt: Date;
    endAt: Date;
    status: string;
  };
  remoteEvent: GoogleCalendarEvent | null;
  isMasterAvailableForSlot?: (startsAt: Date, endsAt: Date) => Promise<boolean> | boolean;
}

/**
 * Evaluates reconciliation decision adhering strictly to Phase 12 source-of-truth rules:
 * - CRM is authoritative.
 * - External changes are accepted only if they respect slot availability and clinical constraints.
 */
export async function evaluateReconciliationDecision(
  context: ReconcileEvaluationContext
): Promise<ReconciliationPolicyResult> {
  const { crmAppointment, remoteEvent, isMasterAvailableForSlot } = context;

  // 1. Remote event deleted or marked cancelled on Google Calendar
  if (!remoteEvent || remoteEvent.status === "cancelled") {
    if (crmAppointment.status === "cancelled") {
      return {
        action: "noop",
        reason: "Both CRM and Google Calendar show appointment as cancelled",
      };
    }

    return {
      action: "cancel",
      reason: "Cancelled or deleted on Google Calendar",
    };
  }

  // 2. Parse remote event start and end
  const remoteStartStr = remoteEvent.start?.dateTime ?? remoteEvent.start?.date;
  const remoteEndStr = remoteEvent.end?.dateTime ?? remoteEvent.end?.date;

  if (!remoteStartStr || !remoteEndStr) {
    return {
      action: "noop",
      reason: "Remote event missing valid datetime fields",
    };
  }

  const remoteStartsAt = new Date(remoteStartStr);
  const remoteEndsAt = new Date(remoteEndStr);

  if (isNaN(remoteStartsAt.getTime()) || isNaN(remoteEndsAt.getTime()) || remoteStartsAt >= remoteEndsAt) {
    return {
      action: "conflict",
      reason: "Remote event has invalid time window",
    };
  }

  // 3. Compare start and end timestamps (within 1-second precision)
  const startDiff = Math.abs(crmAppointment.startAt.getTime() - remoteStartsAt.getTime());
  const endDiff = Math.abs(crmAppointment.endAt.getTime() - remoteEndsAt.getTime());

  if (startDiff < 1000 && endDiff < 1000) {
    return {
      action: "noop",
      reason: "Appointment time is already in sync with Google Calendar",
    };
  }

  // 4. Remote time shifted: verify slot availability
  if (crmAppointment.status === "cancelled") {
    return {
      action: "noop",
      reason: "CRM appointment is already cancelled; external edits ignored",
    };
  }

  if (isMasterAvailableForSlot) {
    const isAvailable = await isMasterAvailableForSlot(remoteStartsAt, remoteEndsAt);
    if (!isAvailable) {
      return {
        action: "conflict",
        reason: "Master is unavailable or has conflicting bookings for proposed Google Calendar time",
        proposedStartsAt: remoteStartsAt,
        proposedEndsAt: remoteEndsAt,
      };
    }
  }

  return {
    action: "reschedule",
    reason: "Rescheduled on Google Calendar",
    proposedStartsAt: remoteStartsAt,
    proposedEndsAt: remoteEndsAt,
  };
}
