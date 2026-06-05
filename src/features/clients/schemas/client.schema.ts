import { z } from "zod";

export const clientSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно"),
  lastName: z.string().optional(),
  phone: z.string().min(1, "Телефон обязателен"),
  whatsapp: z.string().optional(),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  birthDate: z.date().optional().nullable(),
  instagram: z.string().optional(),
  source: z.string().optional(),
  clientStatus: z.enum([
    "new_lead",
    "contacted",
    "needs_consultation",
    "consultation_booked",
    "no_reply",
    "appointment_booked",
    "procedure_done",
    "follow_up",
    "second_session_needed",
    "correction_needed",
    "completed",
    "returning_client",
    "refresh_needed",
    "lost"
  ]),
  leadStatus: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().or(z.array(z.string())).optional(),
  referredByName: z.string().optional(),
  interest: z.string().optional(),
  treatmentZone: z.string().optional(),
  nextContactAt: z.date().optional().nullable(),
  campaignTag: z.string().optional(),
  serviceTag: z.string().optional(),
});

export type ClientSchema = z.infer<typeof clientSchema>;
