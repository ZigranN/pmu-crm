import type { CreateAutomationRuleInput } from "./types";

export interface DefaultRuleTemplate extends CreateAutomationRuleInput {
  isDefault: boolean;
}

export const DEFAULT_AUTOMATION_RULES: DefaultRuleTemplate[] = [
  {
    code: "appointment_reminder_24h",
    name: "Напоминание о записи за 24 часа",
    description: "Создает операционное напоминание для персонала за 24 часа до начала процедуры",
    enabled: true,
    triggerType: "APPOINTMENT_CREATED",
    actionType: "CREATE_OPERATIONAL_REMINDER",
    config: {
      offsetMinutes: -1440, // 24 hours before
      titleTemplate: "Напоминание: запись завтра",
      messageTemplate: "Необходимо связаться с клиентом для подтверждения визита",
      priority: "normal",
    },
    isDefault: true,
  },
  {
    code: "appointment_reminder_2h",
    name: "Напоминание о записи за 2 часа",
    description: "Создает операционное напоминание за 2 часа до начала процедуры",
    enabled: true,
    triggerType: "APPOINTMENT_CREATED",
    actionType: "CREATE_OPERATIONAL_REMINDER",
    config: {
      offsetMinutes: -120, // 2 hours before
      titleTemplate: "Напоминание: запись через 2 часа",
      messageTemplate: "Проверить готовность рабочего места и подтверждение клиента",
      priority: "high",
    },
    isDefault: true,
  },
  {
    code: "conversation_unanswered_followup",
    name: "Контроль неотвеченных сообщений (30 мин)",
    description: "Создает задачу для персонала, если входящее сообщение от клиента остается без ответа более 30 минут",
    enabled: true,
    triggerType: "CONVERSATION_INBOUND_RECEIVED",
    actionType: "CREATE_CONVERSATION_FOLLOW_UP",
    config: {
      durationMinutes: 30,
      titleTemplate: "Неотвеченное входящее сообщение",
      priority: "high",
    },
    isDefault: true,
  },
  {
    code: "procedure_healing_followup_3d",
    name: "Контроль заживления через 3 дня после процедуры",
    description: "Создает задачу для связи с клиентом и контроля процесса заживления через 3 дня после завершения процедуры",
    enabled: true,
    triggerType: "PROCEDURE_COMPLETED",
    actionType: "CREATE_OPERATIONAL_REMINDER",
    config: {
      delayDays: 3,
      delayHours: 0,
      titleTemplate: "Контроль заживления (3 дня)",
      descriptionTemplate: "Узнать о самочувствии клиента и соблюдении рекомендаций по уходу",
      priority: "normal",
    },
    isDefault: true,
  },
  {
    code: "cycle_stage_attention_followup",
    name: "Операционный контроль при смене стадии цикла",
    description: "Сигнализирует о необходимости внимания при переводе цикла на новый этап",
    enabled: true,
    triggerType: "TREATMENT_CYCLE_STAGE_CHANGED",
    actionType: "SURFACE_NEEDS_ATTENTION",
    config: {
      delayHours: 0,
      titleTemplate: "Смена этапа цикла лечения",
      priority: "normal",
    },
    isDefault: true,
  },
];
