import { z } from "zod";
import { LANGUAGE_CODES, INTEREST_ZONE_CODES } from "../administrative";

export const clientSchema = z.object({
  language: z.enum(LANGUAGE_CODES).nullable().optional(),
  interestedZones: z.array(z.enum(INTEREST_ZONE_CODES)).max(5).refine(zones => new Set(zones).size === zones.length, "Зоны не должны повторяться").nullable().optional(),
  clientKind: z.enum(["new", "returning"]).nullable().optional(),
  reportedPreviousPmu: z.boolean().nullable().optional(),
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
  nextContactAt: z.date().optional().nullable(),
  campaignTag: z.string().optional(),
  serviceTag: z.string().optional(),
}).strict();

// Future AI qualification contract: no status, notes, assignment or medical decisions.
// This schema does not grant AI permission to call existing human CRUD actions.
export const administrativeQualificationSchema = clientSchema.pick({ firstName: true, lastName: true, phone: true, whatsapp: true, email: true, instagram: true, language: true, source: true, interestedZones: true, clientKind: true, reportedPreviousPmu: true }).partial().strict();

export type ClientSchema = z.infer<typeof clientSchema>;
