# Phase 3.3 — qualification и решения консультации

14.09.2026. Ветка `codex/phase-3-consultation-decisions`, база — Phase 3.2 / PR №14.

## Реализовано

- `features/consultations/contracts.ts`: строгие command contracts, четыре явных исключения §42 и пять outcomes §43. Не принимаются цена, clearance, чужой actor/studio или произвольный stage.
- `server/qualification.ts`: same-zone история только из связанной PMU-family procedure с завершённым, неархивированным appointment той же студии/клиента. Нужны returning client, актуальная история ≤2 календарных лет по timezone студии, совпадающий мастер и отсутствие всех исключений. Legacy procedure без cycle не даёт автоматического пропуска. Будущая дата, другая зона, другой мастер, отменённый визит и отсутствие доказанной истории требуют консультации.
- Двухлетняя граница включительна по локальной дате студии, 29 февраля ограничивается последним днём февраля соответствующего года. Это зафиксированная реализация календарного срока; будущий визит не считается историей.
- `cycle.qualify.v1`: immutable оценка и evidence snapshot. Специалист подтверждает отсутствие/наличие исключений. Admin продолжает собирать административные поля в карточке, но не подписывает клиническую оценку. `evaluateCurrentQualification` пересчитывает результат по live history/client/master/date вместо доверия сохранённому boolean; будущая booking command обязана использовать такую проверку.
- `consultation.complete.v1`: принимает только связанный законченный completed appointment-консультацию нужного мастера; требует предварительную стадию scheduled/confirmed/completed. Сохраняет завершение и человеческое основание; пишет стадии Completed → Result Required и outbox timer в одной транзакции. Повторный ключ не создаёт второй консультации.
- `consultation.result.v1`: решение Owner/уполномоченного Master с версией, reason/comment, audit/history/event и receipt. Admin/AI, stale/cross-studio/cross-master и повторный конкурирующий результат запрещены. Поля медицинского профиля/clearance, цена и ledger не меняются.
- Общий `treatment-cycles/server/mutation.ts` используется прежними cycle commands и новыми consultation commands. Несколько стадий/связанный Remover могут атомарно принадлежать одному commandId; receipt ограничивает диапазон версий и ID дочернего цикла. Events сохраняют конкретную историческую версию.
- UI в `/deals/[id]`: оценка квалификации, выбор завершённого визита, пять решений, комментарий и будущая reassessment date. Подробности читаются только с MEDICAL_PROFILE_READ, записи — MEDICAL_PROFILE_UPDATE + CLIENT_UPDATE и scope. Generic timeline содержит нейтральные основания, без медицинских комментариев.

## Результаты

| Outcome | Результат команды |
|---|---|
| can_proceed | Стадия Consultation Result; не medical clearance, не подтверждение цены/записи |
| removal_required | Создаёт один Remover той же зоны/клиента с originCycleId; исходный PMU сохраняется и приостанавливается |
| temporarily_unavailable | Приостановка исходного PMU, обязательные reason/comment и будущая reassessmentAt |
| master_cannot_help | Result → Lost с историей человеческого решения |
| client_thinking | Result → Thinking; сохраняется followUpAt через 7×24 часа, без изменения цены |

Контакт Thinking, изменение даты unavailable, возобновление PMU, правила предложения и полный Remover review/ready_for_pmu ещё относятся к 3.4/8.3. Сохранение даты не заявляется как отправленное сообщение или запущенный follow-up workflow.

## Задача отсутствующего решения

`consultation.decision-due.v1` — реальный transactional consumer. После deadline создаёт единственную task с consultationId, текущим ответственным мастером и ссылкой на cycle. До срока task не создаётся. Если решение уже записано, задача не создаётся; если task была создана, result command завершает её атомарно. Повторная доставка не дублирует задачу. Неактивный/непривязанный ответственный приводит к обработке ошибки через существующий worker/Needs Attention, без назначения случайному пользователю.

Рабочий default: `CONSULTATION_DECISION_SLA_HOURS=24`, диапазон 1–168 часов, от фактического окончания визита. **24 часа — настройка реализации, не число из ТЗ.** ТЗ требует «через заданное время», но точное число не задаёт. Перед rollout студия утверждает свой срок. Параметр задаётся окружением; изменение действует на новые consultation records.

Task creation/attempt/delivery имеет trace через consultationId → outbox eventKey/inbox/job attempts. Активация production scheduler и общая acceptance автоматизаций не выполнялись. Текущий интерфейс pending task находится в consultation panel и существующих tasks; полный Needs Attention dashboard — Phase 13.

## Миграция, ограничения и приёмка

Новая миграция `0016_consultation_decisions.sql`: qualifications, consultations, immutable results, nullable task relation, составные FK/evidence guards, расширенный receipt contract. 0015 и более ранняя история не переписаны. SQL включает ручные immutable/deferred guards и дополнительные receipt/task FK, которые не представлены полностью в Drizzle snapshots; сохранять их при будущих изменениях.

Нет автоматического преобразования legacy процедур. Клиентский merge сохраняет записи через стабильный cycleId; task.clientId перемещается вместе с остальным графом. Нет merge PR, миграции/seed Neon.

**Статус 3.3: domain logic/UI реализованы и проверяются, production E2E зависит от Phase 5.** Браузерный тест использует fixtures назначенного cycle и завершённого визита. В текущем приложении ещё нет полного booking path, который сам создаст эти prerequisites. Generic stage selector по-прежнему не может обойти calendar/finance guards. Это не приёмка сквозного Lead → Consultation → Booking.

Повторное редактирование уже подписанного результата не предоставлено: запись immutable; отдельный correction/reassessment workflow предстоит проектировать в 3.4. Не проставлять can_proceed напрямую в medical profile. Qualification-only bypass не является медицинским заключением и сам по себе не записывает клиента.

Локально прошли typecheck, lint, test build, 196 unit/integration и 4 migration tests. PostgreSQL 17 и полный browser suite проверяются CI на head PR.

Проверки: календарная граница/исключения/live reevaluation, все пять outcomes, RBAC/tenant/ownership/replay/stale, реальный overdue task и его закрытие, отменённый/будущий визит, rollback linked Remover при ошибке outbox, immutable evidence, merge preservation, task ownership; отдельный mobile E2E с fixture prerequisites. Typecheck/lint/build и полный CI — на точном head PR.

Следующий шаг — **3.4: реальные follow-up задачи Thinking/unavailable, перенос даты и возобновление**, затем Phase 4. Интеграционные долги 3.2/3.3 остаются до подключения Phase 5–7/10.
