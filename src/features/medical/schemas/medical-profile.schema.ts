import { z } from "zod";

export const medicalProfileSchema = z.object({
  allergies: z.string().optional(),
  contraindications: z.string().optional(),
  skinType: z.string().optional(),
  pregnancyStatus: z.string().optional(),
  medications: z.string().optional(),
  previousPMU: z.boolean().default(false),
  previousPMUNotes: z.string().optional(),
  herpesHistory: z.boolean().default(false),
  diabetes: z.boolean().default(false),
  bloodThinners: z.boolean().default(false),
  keloidRisk: z.boolean().default(false),
  autoimmuneDiseases: z.boolean().default(false),
  recentBotoxFillers: z.boolean().default(false),
  recentPeelingLaser: z.boolean().default(false),
  skinSensitivity: z.boolean().default(false),
  medicalNotes: z.string().optional(),
});

export type MedicalProfileSchema = z.infer<typeof medicalProfileSchema>;
