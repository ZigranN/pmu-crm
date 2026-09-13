# Phase 3.4b — версионированный перенос контакта

14.09.2026. Ветка `codex/phase-3-followup-rescheduling`, база — Phase 3.4a / PR №16.

## Реализовано

- `cycle.follow-up-reschedule.v1`: строгий контракт cycle/result/version, новая будущая дата, обязательные reason/comment. Owner/специалист с MEDICAL_PROFILE_UPDATE + CLIENT_UPDATE и текущим client/cycle scope. Admin и AI не меняют дату клинической оценки. Повторный ключ повторяет исходный результат только после актуальной проверки прав; конкурирующий новый запрос со старой версией отклоняется.
- Перенос допускается для актуальных Thinking и Temporarily unavailable. Он не снимает suspension, не возобновляет Lost или Remover, не меняет clinical result, медицинский допуск, цену, offer или appointment.
- `follow_up_revisions`: append-only история с датой, последовательностью, actor, command, reason/comment и createdAt. Исходная дата остаётся в immutable consultation result. Миграция 0018 проверяет receipt, studio/result и непрерывность последовательности; запрещает UPDATE/DELETE ревизии.
- В одной транзакции создаются revision, нейтральная cycle history/audit запись, новая версия цикла и outbox event. Прежние pending/in_progress задачи этого результата отменяются; completed/cancelled история сохраняется. Сбой любого этапа откатывает все изменения.
- Worker под общим studio lock сравнивает payload revision с последней сохранённой. Старый таймер, в том числе исходный без revisionId, возвращает `schedule_superseded`. Поэтому worker до переноса может создать задачу, которую перенос затем отменит; worker после переноса не создаёт прежнюю задачу.
- Task сохраняет result и revision. Уникальность исходной задачи поддержана partial index; каждая новая revision имеет максимум одну задачу. DB guard запрещает заменять источник, переносить задачу на другой client/studio/visit или менять дату отдельно от revision. UTC-семантика старого tasks.due_at сохранена.
- Панель консультации показывает актуальную дату, статус текущей задачи, форму переноса и последние 50 revisions с причинами/комментариями. Полная история хранится без удаления. Чтение защищено medical access scope и access log.
- Canonical client merge сохраняет все revision/result/task IDs, переносит клиентские связи задач через существующий registry.

## Проверки

Интеграционно проверяются обе ветки, точный срок, многократный перенос, stale timers, повтор команды, конкурирующие переносы, worker vs reschedule, отсутствие обязательных полей, прошедшая/неизменившаяся дата, actor/studio/scope, отозванные права при replay, immutable evidence, task guards, rollback очереди, client merge, запрет обхода Lost/Remover.

Chromium сценарии Thinking и unavailable: сохранение решения → отображение текущей задачи → перенос с намеренно потерянным ответом после commit → повтор с тем же ключом → одна revision, отменённая прежняя task, история после reload. Calendar prerequisites и первая task являются fixtures; timed worker проверяется интеграционно.

Результаты полного typecheck/lint/build/tests и CI фиксируются в PR на окончательный commit.

## Остаток

Следующий инкремент **3.4c**: фактическая повторная оценка и возобновление через human command, Lost с причиной/историей, отмена задач при выходе из ветки или архивировании. Сам перенос даты не является повторной клинической оценкой. **3.4d**: срок предложения и human decision по его условиям. Remover review/ready_for_pmu — 8.3. Production scheduler и исходящие сообщения — Phase 10/9.

Весь 3.4 остаётся PARTIAL. Merge, миграции/seed Neon и deploy не выполнялись. Миграция 0018 подготовлена и проверяется только на изолированных тестовых БД.
