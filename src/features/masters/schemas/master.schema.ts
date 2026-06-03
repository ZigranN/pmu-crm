import { z } from "zod";

export const masterSchema = z.object({
  displayName: z.string().min(1, "Имя мастера обязательно"),
  phone: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  bio: z.string().optional(),
  photoUrl: z.string().optional(),
  calendarColor: z.string(),
  isActive: z.boolean(),
  serviceIds: z.array(z.string()).optional(),
});

export type MasterSchema = z.infer<typeof masterSchema>;
