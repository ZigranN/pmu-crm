import { z } from "zod";

export const strokePointSchema = z
  .object({
    x: z.number().min(0).max(5000),
    y: z.number().min(0).max(5000),
    t: z.number().optional(),
    pressure: z.number().min(0).max(1).optional(),
  })
  .strict();

export const strokeSchema = z
  .object({
    points: z.array(strokePointSchema).min(1).max(5000),
    color: z.string().max(30).optional(),
    width: z.number().min(0.1).max(50).optional(),
  })
  .strict();

export const drawSignaturePayloadSchema = z
  .object({
    format: z.literal("strokes_v1"),
    width: z.number().min(10).max(2000),
    height: z.number().min(10).max(2000),
    strokes: z.array(strokeSchema).min(1).max(200),
  })
  .strict();

export type DrawSignaturePayload = z.infer<typeof drawSignaturePayloadSchema>;

export const signaturePayloadSchema = z.union([
  drawSignaturePayloadSchema,
  z.record(z.string(), z.unknown()),
]);

export const createCycleConsentDraftSchema = z
  .object({
    cycleId: z.string().uuid("Invalid cycle ID"),
    templateVersionId: z.string().uuid("Invalid template version ID"),
    zoneCodes: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Zone code cannot be empty")
          .max(50, "Zone code must not exceed 50 characters")
      )
      .min(1, "At least one zone code is required"),
  })
  .strict();

export type CreateCycleConsentDraftInput = z.infer<
  typeof createCycleConsentDraftSchema
>;

export const signCycleConsentSchema = z
  .object({
    consentId: z.string().uuid("Invalid consent ID"),
    signatoryName: z
      .string()
      .trim()
      .min(1, "Signatory name is required")
      .max(255, "Signatory name must not exceed 255 characters"),
    signatoryRole: z.enum(["client", "guardian", "representative"]),
    signatureMethod: z.enum(["draw_on_screen", "in_person_stylus"]),
    signaturePayload: signaturePayloadSchema,
  })
  .strict();

export type SignCycleConsentInput = z.infer<typeof signCycleConsentSchema>;
