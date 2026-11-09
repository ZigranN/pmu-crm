import type { googleCalendarConnections, googleCalendarEventMappings } from "@/db/schema";

export type GoogleCalendarConnectionRecord = typeof googleCalendarConnections.$inferSelect;
export type GoogleCalendarConnectionInsert = typeof googleCalendarConnections.$inferInsert;

export type GoogleCalendarEventMappingRecord = typeof googleCalendarEventMappings.$inferSelect;
export type GoogleCalendarEventMappingInsert = typeof googleCalendarEventMappings.$inferInsert;

export interface GoogleCalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start: GoogleCalendarEventTime;
  end: GoogleCalendarEventTime;
  etag?: string;
  updated?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
  accessRole?: string;
}

export interface SyncAppointmentPayload {
  appointmentId: string;
  action: "upsert" | "delete";
  reason?: string;
}

export interface SyncAppointmentResult {
  connectionId: string;
  appointmentId: string;
  action: "created" | "updated" | "deleted" | "skipped" | "error";
  googleEventId?: string;
  error?: string;
}

export interface ReconciliationPolicyResult {
  action: "noop" | "reschedule" | "cancel" | "conflict";
  reason: string;
  proposedStartsAt?: Date;
  proposedEndsAt?: Date;
}

export interface BatchReconciliationResult {
  connectionId: string;
  totalEvaluated: number;
  rescheduledCount: number;
  cancelledCount: number;
  conflictCount: number;
  skippedCount: number;
  errors: string[];
}
