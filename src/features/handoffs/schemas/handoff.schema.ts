import { z } from "zod";
import {
  HANDOFF_ENTITY_TYPES,
  HANDOFF_PRIORITIES,
  HANDOFF_SOURCE_TYPES,
  HANDOFF_STATUSES,
} from "@/db/schema";

export const createHandoffSchema = z.object({
  entityType: z.enum(HANDOFF_ENTITY_TYPES),
  entityId: z.string().min(1, "ID сущности обязателен"),
  clientId: z.string().uuid().optional().nullable(),
  cycleId: z.string().uuid().optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
  fromUserId: z.string().optional().nullable(),
  toUserId: z.string().min(1, "Назначенный сотрудник обязателен"),
  sourceType: z.enum(HANDOFF_SOURCE_TYPES).default("HUMAN"),
  reasonCode: z.string().min(1, "Код причины обязателен").max(100),
  reasonText: z.string().max(1000).optional().nullable(),
  priority: z.enum(HANDOFF_PRIORITIES).default("NORMAL"),
  dueAt: z.coerce.date().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  requestKey: z.string().uuid().optional().nullable(),
});

export type CreateHandoffInput = z.input<typeof createHandoffSchema>;

export const acceptHandoffSchema = z.object({
  handoffId: z.string().uuid("ID передачи должен быть корректным UUID"),
  requestKey: z.string().uuid().optional().nullable(),
});

export type AcceptHandoffInput = z.input<typeof acceptHandoffSchema>;

export const rejectHandoffSchema = z.object({
  handoffId: z.string().uuid("ID передачи должен быть корректным UUID"),
  reason: z.string().trim().min(1, "Причина отклонения обязательна").max(1000),
  requestKey: z.string().uuid().optional().nullable(),
});

export type RejectHandoffInput = z.input<typeof rejectHandoffSchema>;

export const cancelHandoffSchema = z.object({
  handoffId: z.string().uuid("ID передачи должен быть корректным UUID"),
  reason: z.string().trim().max(1000).optional().nullable(),
  requestKey: z.string().uuid().optional().nullable(),
});

export type CancelHandoffInput = z.input<typeof cancelHandoffSchema>;

export const completeHandoffSchema = z.object({
  handoffId: z.string().uuid("ID передачи должен быть корректным UUID"),
  notes: z.string().trim().max(1000).optional().nullable(),
  requestKey: z.string().uuid().optional().nullable(),
});

export type CompleteHandoffInput = z.input<typeof completeHandoffSchema>;

export const handoffFiltersSchema = z.object({
  assignedToMe: z.boolean().optional(),
  createdByMe: z.boolean().optional(),
  status: z.enum(HANDOFF_STATUSES).optional(),
  priority: z.enum(HANDOFF_PRIORITIES).optional(),
  overdueOnly: z.boolean().optional(),
  entityType: z.enum(HANDOFF_ENTITY_TYPES).optional(),
  clientId: z.string().uuid().optional(),
  toUserId: z.string().optional(),
  search: z.string().optional(),
});
