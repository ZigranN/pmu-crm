import { z } from "zod";
import { serviceCategoryEnum, procedureTypeEnum } from "@/db/schema";

export const serviceSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().optional(),
  category: z.enum(serviceCategoryEnum.enumValues),
  procedureType: z.enum(procedureTypeEnum.enumValues),
  price: z.coerce.number().min(0),
  durationMinutes: z.coerce.number().min(5, "Минимум 5 минут"),
  bufferBeforeMinutes: z.coerce.number().min(0),
  bufferAfterMinutes: z.coerce.number().min(0),
  requiresCorrection: z.boolean(),
  correctionAfterDays: z.coerce.number().nullable().optional(),
  isActive: z.boolean(),
});

export type ServiceSchema = z.infer<typeof serviceSchema>;
