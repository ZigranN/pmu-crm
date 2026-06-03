import { z } from "zod";

export const studioSchema = z.object({
  name: z.string().min(1, "Название студии обязательно"),
  slug: z.string().min(1, "Slug обязателен"),
  timezone: z.string().default("Europe/Rome"),
  country: z.string().min(1, "Страна обязательна"),
  city: z.string().min(1, "Город обязателен"),
});

export const studioMemberSchema = z.object({
  studioId: z.string().uuid(),
  userId: z.string(),
  roleId: z.string().uuid(),
});
