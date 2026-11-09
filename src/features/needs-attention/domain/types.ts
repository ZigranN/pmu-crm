export const ATTENTION_REASON_CODES = [
  "MEDICAL_REVIEW_REQUIRED",
  "MEDICAL_NOT_CLEARED",
  "CONSENT_MISSING",
  "CONSENT_INVALID",
  "APPOINTMENT_MISSING",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_PAST_DUE",
  "CYCLE_STALLED",
  "FOLLOW_UP_OVERDUE",
  "OUTSTANDING_BALANCE",
  "TOTAL_FACE_PARTIALLY_COMPLETE",
  "TOTAL_FACE_BLOCKED",
  "REMOVER_FOLLOW_UP_REQUIRED",
] as const;

export type AttentionReasonCode = (typeof ATTENTION_REASON_CODES)[number];

export const ATTENTION_SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_ENTITY_TYPES = [
  "CLIENT",
  "TREATMENT_CYCLE",
  "APPOINTMENT",
  "PACKAGE",
  "CONSULTATION",
] as const;

export type AttentionEntityType = (typeof ATTENTION_ENTITY_TYPES)[number];

export type AttentionOwnershipState =
  | "UNASSIGNED"
  | "ASSIGNED"
  | "HANDOFF_PENDING"
  | "ACCEPTED";

export interface NeedsAttentionItem {
  id: string;
  attentionRequired: boolean;
  severity: AttentionSeverity;
  reasonCode: AttentionReasonCode;
  title: string;
  description: string;
  entityType: AttentionEntityType;
  entityId: string;
  clientId: string;
  clientName?: string;
  clientPhone?: string;
  cycleId?: string;
  zoneCode?: string;
  packageId?: string;
  appointmentId?: string;
  masterId?: string;
  masterName?: string;
  dueAt?: Date | null;
  isOverdue?: boolean;
  createdAt?: Date;
  suggestedAction: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
  ownershipState?: AttentionOwnershipState;
  handoffId?: string | null;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  pendingAssigneeId?: string | null;
  pendingAssigneeName?: string | null;
}

export interface AttentionFilterOptions {
  masterId?: string;
  reason?: AttentionReasonCode;
  severity?: AttentionSeverity;
  clientId?: string;
  search?: string;
}

export interface AttentionSummaryCounts {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  medical: number;
  consent: number;
  appointments: number;
  finance: number;
  packages: number;
  stalled: number;
}
