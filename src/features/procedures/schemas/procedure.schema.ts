import { z } from "zod";

export const START_PROCEDURE_SCHEMA = z.object({
  cycleId: z.string().uuid("Некорректный ID цикла"),
  appointmentId: z.string().uuid("Некорректный ID визита").optional().nullable(),
  masterId: z.string().uuid("Некорректный ID мастера").optional(),
  serviceId: z.string().uuid("Некорректный ID услуги").optional(),
  startedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional().nullable(),
  commandId: z.string().optional(),
});

export type StartProcedureInput = z.infer<typeof START_PROCEDURE_SCHEMA>;

export const PROCEDURE_PIGMENT_INPUT_SCHEMA = z.object({
  pigmentId: z.string().uuid("Некорректный ID пигмента"),
  mixRatio: z.string().max(50).optional().nullable(),
  drops: z.number().int().positive("Количество капель должно быть больше нуля").optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type ProcedurePigmentInput = z.infer<typeof PROCEDURE_PIGMENT_INPUT_SCHEMA>;

export const COMPLETE_PROCEDURE_SCHEMA = z.object({
  procedureSessionId: z.string().uuid("Некорректный ID процедуры"),
  completedAt: z.string().datetime().optional(),
  commandId: z.string().optional(),
  healingStage: z
    .enum(["fresh", "day_2_3", "day_7", "day_30", "healed", "needs_correction", "completed"])
    .optional()
    .nullable(),
  anesthesia: z.string().max(200).optional().nullable(),
  cartridge: z.string().max(100).optional().nullable(),
  needle: z.string().max(100).optional().nullable(),
  voltage: z.string().max(50).optional().nullable(),
  machine: z.string().max(100).optional().nullable(),
  skinReaction: z.string().max(200).optional().nullable(),
  painLevel: z.number().int().min(0).max(10).optional().nullable(),
  notes: z.string().max(3000).optional().nullable(),
  recommendations: z.string().max(3000).optional().nullable(),
  nextStep: z
    .enum([
      "book_second_session",
      "book_correction",
      "wait_healing",
      "refresh_later",
      "completed",
      "contact_client",
      "control_needed",
    ])
    .optional()
    .nullable(),
  nextRecommendedDate: z.string().datetime().optional().nullable(),
  techniqueId: z.string().uuid().optional().nullable(),
  techniqueSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  pigments: z.array(PROCEDURE_PIGMENT_INPUT_SCHEMA).optional().default([]),
});

export type CompleteProcedureInput = z.infer<typeof COMPLETE_PROCEDURE_SCHEMA>;

export const ABORT_PROCEDURE_SCHEMA = z.object({
  procedureSessionId: z.string().uuid("Некорректный ID процедуры"),
  reason: z
    .string()
    .trim()
    .min(3, "Причина прерывания процедуры должна содержать минимум 3 символа")
    .max(1000, "Причина не может превышать 1000 символов"),
  notes: z.string().max(2000).optional().nullable(),
  abortedAt: z.string().datetime().optional(),
});

export type AbortProcedureInput = z.infer<typeof ABORT_PROCEDURE_SCHEMA>;

export const UPDATE_PROCEDURE_EVIDENCE_SCHEMA = z.object({
  procedureSessionId: z.string().uuid("Некорректный ID процедуры"),
  healingStage: z
    .enum(["fresh", "day_2_3", "day_7", "day_30", "healed", "needs_correction", "completed"])
    .optional()
    .nullable(),
  anesthesia: z.string().max(200).optional().nullable(),
  cartridge: z.string().max(100).optional().nullable(),
  needle: z.string().max(100).optional().nullable(),
  voltage: z.string().max(50).optional().nullable(),
  machine: z.string().max(100).optional().nullable(),
  skinReaction: z.string().max(200).optional().nullable(),
  painLevel: z.number().int().min(0).max(10).optional().nullable(),
  notes: z.string().max(3000).optional().nullable(),
  recommendations: z.string().max(3000).optional().nullable(),
  techniqueId: z.string().uuid().optional().nullable(),
  techniqueSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  pigments: z.array(PROCEDURE_PIGMENT_INPUT_SCHEMA).optional(),
});

export type UpdateProcedureEvidenceInput = z.infer<typeof UPDATE_PROCEDURE_EVIDENCE_SCHEMA>;
