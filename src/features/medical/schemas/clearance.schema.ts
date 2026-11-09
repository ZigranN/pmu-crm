import { z } from "zod";
import { CYCLE_MEDICAL_CLEARANCE_DECISIONS } from "@/db/schema";

export const recordMedicalClearanceSchema = z
  .object({
    cycleId: z.string().uuid(),
    medicalRevisionId: z.string().uuid(),
    expectedCycleVersion: z.number().int().positive(),
    decision: z.enum(CYCLE_MEDICAL_CLEARANCE_DECISIONS),
    reason: z.string().trim().min(3).max(1000),
    clinicalNotes: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional(),
  })
  .strict();

export type RecordMedicalClearanceInput = z.infer<typeof recordMedicalClearanceSchema>;
