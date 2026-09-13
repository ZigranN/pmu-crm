# Phase 3.4a — задачи повторного контакта

14.09.2026. Ветка `codex/phase-3-cycle-followups`, база — Phase 3.3 / PR №15. Это завершённый инкремент внутри 3.4; весь шаг 3.4 остаётся PARTIAL.

## Реализовано

- `consultation.result.v1` атомарно сохраняет решение и событие `cycle.follow-up-due.v1`. Для Thinking используется сохранённая дата +7×24 часа; для unavailable — будущая дата, указанная специалистом. Права, version check, audit и command receipt остаются в общем command boundary.
- `features/treatment-cycles/server/followups.ts`: transactional worker читает дату из immutable результата, проверяет актуальность консультации, стадию, suspension, архивирование клиента/цикла и доступ действующего мастера. Неправильная студия, произвольная дата в payload, потерянные права или scope не позволяют создать задачу. Ошибка ответственного попадает в существующий Needs Attention.
- До срока задачи нет. В срок создаётся одна task с нейтральным названием и ссылкой на цикл. Причина медицинского решения не копируется в описание. Reassessment task не снимает suspension и не выдаёт medical clearance.
- Inbox и создание задачи коммитятся вместе. Уникальный `tasks.follow_up_result_id` защищает также от повторной доставки с другим event key. Уже выполненная/отменённая задача не открывается заново.
- `0017_cycle_follow_up_tasks.sql`: nullable ссылка, FK, unique index и deferred guard связи result → consultation → cycle → client/visit/studio/date. Источник задачи нельзя отсоединить или заменить. Legacy `tasks.due_at` интерпретируется как UTC при сравнении с timestamptz решения; часовой пояс сессии PostgreSQL не меняет срок.
- Миграция регистрирует существующие Thinking/unavailable решения в очереди через `ON CONFLICT DO NOTHING`, сохраняя совместимый canonical payload hash. Она не создаёт задачи сразу и не меняет решения: worker повторно проверяет текущее состояние. Это подготовленный SQL, в Neon он не запускался.
- Панель консультации показывает статус созданной задачи; чтение использует существующие medical permission/scope/access log. Объединение клиентов сохраняет ID решения/задачи и переносит client linkage.

## Проверки

Локально: typecheck, lint, build:test; 205 unit/integration tests и 4 migration tests. Новые сценарии: точная граница срока с контролируемыми часами, обе ветки решения, replay, worker/inbox, migration catch-up/hash, rollback при сбое очереди, tenant isolation, архивирование, отозванные права/scope, неизменность clinical/commercial state, DB guards и client merge.

Browser suite дополнен мобильным Thinking path: решение через UI → durable event → отображение задачи после reload. Calendar prerequisites и задача для проверки отображения — явные fixtures; timed worker отдельно проверяется интеграционно. Результат PostgreSQL/Chromium CI фиксируется в PR после прогона.

## Обязательный остаток 3.4

1. **3.4b — перенос и повторная оценка:** отдельная версионированная команда специалиста с reason/comment, immutable schedule revisions, отменой прежней pending task и проверкой актуальной revision в worker. Исходный consultation result не изменять. Тесты: конкурирующий перенос, replay, потеря прав, job vs reschedule, перенос после уже созданной задачи.
2. **3.4c — возобновление и Lost:** human commands и UI, история причин, повторная qualification/evaluation, завершение/отмена follow-up tasks при выходе из ветки. Нельзя обходить medical clearance, существующие визиты/финансы или suspension `removal_required`. Полный Remover `ready_for_pmu` относится к 8.3.
3. **3.4d — условия предложения:** показывать срок действующей offer revision, требовать human decision при изменении/истечении условий; без автоматического пересчёта цены. Тесты срока, неизменности snapshot, разницы между контактным сроком и сроком предложения.
4. Production scheduler rollout и реальные исходящие контакты — Phase 10/9. В этом инкременте нет автоматической отправки клиенту. Существующие pending tasks пока не закрываются автоматически при архивировании/смене стадии после их создания; новые задачи для неактуальной ветки worker не создаёт. Lifecycle cancellation закрывается в 3.4b/c.

Merge, Neon migration/seed и deploy не выполнялись.
