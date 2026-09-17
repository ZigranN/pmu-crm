import { z } from "zod";
// Names only in 3.1; transition commands/guards are implemented in 3.2.
export const CYCLE_STAGES = ["new_lead", "qualification", "consultation_needed", "consultation_offered", "consultation_scheduled", "consultation_confirmed", "consultation_completed", "consultation_result_required", "consultation_result", "thinking", "procedure_slot_selected", "awaiting_acconto", "procedure_confirmed", "first_session_completed", "second_session_scheduled", "second_session_completed", "control_scheduled", "cycle_completed", "refresh_offered", "refresh_no_response", "lost"] as const;
export const CYCLE_KINDS = ["pmu", "refresh", "remover", "paid_correction", "free_correction", "non_pmu"] as const;
export const CYCLE_ZONES = ["brows", "eyes", "lips", "lashes", "skin"] as const;
export const cycleDraftSchema = z.object({
  clientId: z.string().uuid(), zoneCode: z.enum(CYCLE_ZONES), kind: z.enum(CYCLE_KINDS),
  serviceId: z.string().uuid().nullable().default(null), assignedMasterId: z.string().uuid().nullable().default(null),
  packageId: z.string().uuid().nullable().default(null), originCycleId: z.string().uuid().nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.kind !== "non_pmu" && !["brows","eyes","lips"].includes(value.zoneCode)) context.addIssue({code:"custom",path:["zoneCode"],message:"Для PMU требуется одна зона: брови, глаза или губы"});
  if (["refresh","paid_correction","free_correction"].includes(value.kind) && !value.originCycleId) context.addIssue({code:"custom",path:["originCycleId"],message:"Укажите исходный цикл"});
  if (value.packageId && value.kind !== "pmu") context.addIssue({code:"custom",path:["packageId"],message:"В Total Face входят исходные PMU-циклы"});
});
export type CycleDraft = z.infer<typeof cycleDraftSchema>;
