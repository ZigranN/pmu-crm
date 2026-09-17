import { z } from "zod";
export const MERGE_FIELDS = {
  firstName: "Имя", lastName: "Фамилия", phone: "Телефон", whatsapp: "WhatsApp", email: "Email", instagram: "Instagram", birthDate: "Дата рождения",
  source: "Источник", clientStatus: "Статус", leadStatus: "Статус лида", notes: "Заметки", tags: "Теги", referredByName: "Рекомендатель", interest: "Интерес",
  treatmentZone: "Прежняя зона", nextContactAt: "Следующий контакт", campaignTag: "Кампания", serviceTag: "Тег услуги", language: "Язык", interestedZones: "Зоны интереса",
  clientKind: "Тип клиента", reportedPreviousPmu: "Предыдущий PMU со слов клиента", preferredMasterId: "Предпочтительный мастер", assignedMasterId: "Назначенный мастер",
} as const;
export type MergeField = keyof typeof MERGE_FIELDS;
export const pairSchema = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid() }).strict().refine(value => value.sourceId !== value.targetId, "Нужны разные карточки");
export const mergeSchema = z.object({
  sourceId: z.string().uuid(), targetId: z.string().uuid(), token: z.string().length(64), reason: z.string().trim().min(3).max(1000),
  choices: z.partialRecord(z.enum(Object.keys(MERGE_FIELDS) as [MergeField, ...MergeField[]]), z.enum(["source", "target"])),
}).strict().refine(value => value.sourceId !== value.targetId, "Нужны разные карточки");
export type MergeInput = z.infer<typeof mergeSchema>;
export const MERGE_RELATION_LABELS: Record<string, string> = {
  treatment_packages: "Пакеты", treatment_cycles: "Циклы лечения", appointment_cycles: "Связи визитов и циклов",
  client_assignments: "История назначений мастера", client_status_history: "История статусов", appointments: "Визиты", procedure_sessions: "Процедуры",
  media: "Медиафайлы", consents: "Согласия", payments: "Оплаты", payment_transactions: "Финансовые операции", tasks: "Задачи", notifications: "Уведомления",
  activity_events: "События", questionnaire_responses: "Ответы анкет", reviews: "Отзывы", custom_offers: "Индивидуальные предложения",
  client_duplicate_decisions: "Решения о совпадениях", client_medical_profiles: "Медицинские профили",
};
