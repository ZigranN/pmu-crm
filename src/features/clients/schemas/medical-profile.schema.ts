import { z } from "zod";

export const medicalProfileSchema = z.object({
  allergies: z.string().optional(),
  contraindications: z.string().optional(),
  skinType: z.string().optional(),
  pregnancyStatus: z.string().optional(),
  medications: z.string().optional(),
  previousPMU: z.boolean(),
  previousPMUNotes: z.string().optional(),
  herpesHistory: z.boolean(),
  diabetes: z.boolean(),
  bloodThinners: z.boolean(),
  keloidRisk: z.boolean(),
  autoimmuneDiseases: z.boolean(),
  recentBotoxFillers: z.boolean(),
  recentPeelingLaser: z.boolean(),
  skinSensitivity: z.boolean(),
  medicalNotes: z.string().optional(),
});

export type MedicalProfileSchema = z.infer<typeof medicalProfileSchema>;
