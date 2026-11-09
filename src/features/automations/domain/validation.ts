import {
  appointmentReminderConfigSchema,
  conversationFollowUpConfigSchema,
  procedureFollowUpConfigSchema,
  treatmentCycleStageConfigSchema,
  genericAutomationConfigSchema,
  type AutomationTriggerType,
  type AutomationActionType,
} from "./types";

export function validateRuleConfig(
  triggerType: AutomationTriggerType,
  actionType: AutomationActionType,
  rawConfig: unknown
): Record<string, unknown> {
  const config = (rawConfig && typeof rawConfig === "object" ? rawConfig : {}) as Record<
    string,
    unknown
  >;

  switch (triggerType) {
    case "APPOINTMENT_CREATED":
    case "APPOINTMENT_RESCHEDULED":
    case "APPOINTMENT_REMINDER_DUE":
      return appointmentReminderConfigSchema.parse(config);

    case "CONVERSATION_INBOUND_RECEIVED":
    case "CONVERSATION_FOLLOW_UP_DUE":
      return conversationFollowUpConfigSchema.parse(config);

    case "PROCEDURE_COMPLETED":
      return procedureFollowUpConfigSchema.parse(config);

    case "TREATMENT_CYCLE_STAGE_CHANGED":
      return treatmentCycleStageConfigSchema.parse(config);

    case "MEDICAL_REVIEW_REQUIRED":
    case "CONSENT_REQUIRED":
    case "APPOINTMENT_CANCELLED":
    default:
      return genericAutomationConfigSchema.parse(config);
  }
}

/**
 * Builds a deterministic, collision-resistant event key for an outbox automation job.
 * Format: `auto:${ruleCode}:${entityType}:${entityId}:${qualifier}`
 */
export function buildAutomationEventKey(params: {
  ruleCode: string;
  entityType: string;
  entityId: string;
  qualifier?: string | number;
}): string {
  const q = params.qualifier !== undefined && params.qualifier !== null ? `:${params.qualifier}` : "";
  return `auto:${params.ruleCode}:${params.entityType}:${params.entityId}${q}`;
}
