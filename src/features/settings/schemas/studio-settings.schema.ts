import { z } from "zod";

export const studioSettingsSchema = z.object({
  name: z.string().min(1, "Название студии обязательно"),
  slug: z.string().min(1, "Slug обязателен"),
  logoUrl: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().default("Europe/Rome"),
  whatsappNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  instagram: z.string().optional(),
});

export type StudioSettingsSchema = z.infer<typeof studioSettingsSchema>;
