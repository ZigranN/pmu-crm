import { CYCLE_STAGES } from "./schemas/cycle.schema";
export type CycleStage = typeof CYCLE_STAGES[number];
export const STAGE_LABELS: Record<CycleStage,string> = {
  new_lead:"Новый лид", qualification:"Квалификация", consultation_needed:"Нужна консультация", consultation_offered:"Консультация предложена",
  consultation_scheduled:"Консультация назначена", consultation_confirmed:"Консультация подтверждена", consultation_completed:"Консультация завершена",
  consultation_result_required:"Требуется решение мастера", consultation_result:"Решение мастера", thinking:"Клиент думает",
  procedure_slot_selected:"Выбран слот процедуры", awaiting_acconto:"Ожидается предоплата", procedure_confirmed:"Процедура подтверждена",
  first_session_completed:"Первая процедура завершена", second_session_scheduled:"Вторая процедура назначена", second_session_completed:"Вторая процедура завершена",
  control_scheduled:"Контроль назначен", cycle_completed:"Цикл завершён", refresh_offered:"Refresh предложен", refresh_no_response:"Нет ответа на Refresh", lost:"Потерян",
};
// Directed business graph. An edge is necessary but never sufficient: the server also
// requires the authoritative domain command/evidence that owns the target stage.
export const TRANSITIONS: Readonly<Record<CycleStage,readonly CycleStage[]>> = {
  new_lead:["qualification","lost"], qualification:["consultation_needed","procedure_slot_selected","lost"],
  consultation_needed:["consultation_offered","lost"], consultation_offered:["consultation_scheduled","lost"],
  consultation_scheduled:["consultation_confirmed","lost"], consultation_confirmed:["consultation_completed","lost"],
  consultation_completed:["consultation_result_required"], consultation_result_required:["consultation_result"],
  consultation_result:["thinking","procedure_slot_selected","lost"], thinking:["procedure_slot_selected","lost"],
  procedure_slot_selected:["awaiting_acconto"], awaiting_acconto:["procedure_confirmed","lost"],
  procedure_confirmed:["first_session_completed"], first_session_completed:["second_session_scheduled"],
  second_session_scheduled:["second_session_completed"], second_session_completed:["control_scheduled"],
  control_scheduled:["cycle_completed"], cycle_completed:["refresh_offered"], refresh_offered:["refresh_no_response"], refresh_no_response:[], lost:[],
};
// Until these owners exist, manual stage changes must not forge their business facts.
export const REQUIRED_COMMAND: Partial<Record<CycleStage,string>> = {
  consultation_scheduled:"Запись на консультацию через календарь", consultation_confirmed:"Подтверждение записи через календарь",
  consultation_completed:"Завершение консультации", consultation_result_required:"Событие завершения консультации",
  consultation_result:"Решение мастера по консультации", thinking:"Решение мастера и дата повторного контакта",
  procedure_slot_selected:"Проверка допуска и выбор реального слота", awaiting_acconto:"Удержание слота и требование предоплаты",
  procedure_confirmed:"Подтверждённая оплата в реестре платежей", first_session_completed:"Завершение первой процедуры",
  second_session_scheduled:"Запись второй процедуры с проверкой срока", second_session_completed:"Завершение второй процедуры",
  control_scheduled:"Запись на контроль", cycle_completed:"Решение мастера на контроле",
  refresh_offered:"Предложение Refresh с проверкой срока", refresh_no_response:"Событие истечения срока ответа на Refresh",
};

export const ZONE_LABELS:Record<string,string>={brows:"Брови",eyes:"Глаза",lips:"Губы",skin:"Кожа",lashes:"Ресницы"};
