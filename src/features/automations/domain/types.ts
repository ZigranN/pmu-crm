import { z } from "zod";
import {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_EXECUTION_STATUSES,
  type AutomationTriggerType,
  type AutomationActionType,
  type AutomationExecutionStatus,
} from "@/db/schema";

export {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_EXECUTION_STATUSES,
  type AutomationTriggerType,
  type AutomationActionType,
  type AutomationExecutionStatus,
};

// ─── Rule Config Schemas ──────────────────────────────────────────

export const appointmentReminderConfigSchema = z.object({
  // Offset in minutes relative to appointment start time.
  // Negative numbers mean BEFORE appointment (e.g. -1440 = 24h before, -120 = 2h before).
  // Positive numbers mean AFTER appointment (e.g. 120 = 2h after).
  offsetMinutes: z.number().int().min(-43200).max(43200).default(-1440),
  titleTemplate: z.string().min(1).max(200).default("Напоминание о записи"),
  messageTemplate: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const conversationFollowUpConfigSchema = z.object({
  // Duration in minutes since inbound message without staff reply
  durationMinutes: z.number().int().min(1).max(43200).default(30),
  titleTemplate: z.string().min(1).max(200).default("Неотвеченное сообщение в диалоге"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("high"),
});

export const procedureFollowUpConfigSchema = z.object({
  // Delay in days or hours after procedure completed
  delayDays: z.number().int().min(0).max(365).default(3),
  delayHours: z.number().int().min(0).max(23).default(0),
  titleTemplate: z.string().min(1).max(200).default("Контроль заживления после процедуры"),
  descriptionTemplate: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const treatmentCycleStageConfigSchema = z.object({
  stage: z.string().optional(),
  delayHours: z.number().int().min(0).max(8760).default(0),
  titleTemplate: z.string().min(1).max(200).default("Действие по этапу цикла"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const genericAutomationConfigSchema = z.object({
  offsetMinutes: z.number().int().optional(),
  delayHours: z.number().int().optional(),
  delayDays: z.number().int().optional(),
  titleTemplate: z.string().min(1).max(200).optional(),
  messageTemplate: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AppointmentReminderConfig = z.infer<typeof appointmentReminderConfigSchema>;
export type ConversationFollowUpConfig = z.infer<typeof conversationFollowUpConfigSchema>;
export type ProcedureFollowUpConfig = z.infer<typeof procedureFollowUpConfigSchema>;
export type TreatmentCycleStageConfig = z.infer<typeof treatmentCycleStageConfigSchema>;
export type GenericAutomationConfig = z.infer<typeof genericAutomationConfigSchema>;

export type AutomationRuleConfig =
  | AppointmentReminderConfig
  | ConversationFollowUpConfig
  | ProcedureFollowUpConfig
  | TreatmentCycleStageConfig
  | GenericAutomationConfig;

// ─── Rule CRUD Schemas ────────────────────────────────────────────

export const createAutomationRuleSchema = z.object({
  code: z
    .string()
    .min(2, "Код правила должен содержать минимум 2 символа")
    .max(100)
    .regex(/^[a-z0-9_-]+$/i, "Код может содержать только латинские буквы, цифры, дефис и подчеркивание"),
  name: z.string().min(2, "Название должно содержать минимум 2 символа").max(200),
  description: z.string().max(1000).optional().nullable(),
  enabled: z.boolean().default(true),
  triggerType: z.enum(AUTOMATION_TRIGGER_TYPES),
  actionType: z.enum(AUTOMATION_ACTION_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateAutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  enabled: z.boolean().optional(),
  actionType: z.enum(AUTOMATION_ACTION_TYPES).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;

// ─── Trigger Event Interfaces ─────────────────────────────────────

export interface TriggerEvent {
  type: AutomationTriggerType;
  studioId: string;
  entityType: "appointment" | "conversation" | "procedure_session" | "treatment_cycle" | "client";
  entityId: string;
  clientId?: string | null;
  timestamp?: Date;
  referenceTime?: Date; // e.g. appointment startsAt, message sentAt, procedure completedAt
  version?: string | number;
  metadata?: Record<string, unknown>;
}

// ─── Job Payload Interface ────────────────────────────────────────

export interface AutomationJobPayload {
  executionId: string;
  ruleId: string;
  ruleCode: string;
  triggerType: AutomationTriggerType;
  actionType: AutomationActionType;
  entityType: string;
  entityId: string;
  clientId?: string | null;
  scheduledFor: string; // ISO string
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ─── Execution Result ─────────────────────────────────────────────

export interface AutomationExecutionResult {
  action: AutomationActionType;
  entityType: string;
  entityId: string;
  status: "succeeded" | "skipped" | "cancelled" | "failed";
  reason?: string;
  createdEntities?: {
    taskId?: string;
    notificationId?: string;
    messageId?: string;
    [key: string]: string | undefined;
  };
  executedAt: string;
}
