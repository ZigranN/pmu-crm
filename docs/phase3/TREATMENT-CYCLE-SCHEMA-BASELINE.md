# Phase 3.1 — Treatment Cycle schema foundation

13.09.2026. Ветка `codex/phase-3-cycle-schema`, основана на Phase 2.5. Это ограниченный шаг ROADMAP, не приёмка полного PMU workflow.

## Реализовано

- `src/db/schema.ts`, `relations.ts`: отдельные `treatment_cycles` одной реальной зоны, `treatment_packages` и `appointment_cycles`. У клиента могут быть независимые повторные циклы одной зоны; визит может обслуживать несколько циклов.
- Nullable `procedure_sessions.cycle_id` связывает новую процедуру с соответствующим cycle и appointment_cycles. Старые процедуры остаются без cycle, без потери данных.
- `features/treatment-cycles/schemas/cycle.schema.ts`: имена 21 стадии, kinds и строгий контракт draft без цены, stage и medical decisions. Публичной create/update команды пока нет.
- Cycle snapshots, version, независимые session timestamps; origin для refresh/remover/corrections; offerRevision FK с проверкой клиента; package shell с уникальными тремя PMU-зонами.
- Studio/client/zone FK и CHECK constraints; deferred triggers запрещают origin loops, несовместимые normalized service и procedure zones. Обратная проверка не позволяет изменить родителя на Remover/non-PMU или зону вопреки связанной процедуре.
- Merge registry/preview/commit теперь переносит новые сущности. Тест сохраняет package, три cycles, visit links и связанную procedure: изменяется только clientId, исходные IDs/snapshots/timestamps/version сохраняются.
- Owner report `/settings/cycle-migration`: несопоставленные старые визиты/процедуры, причины неоднозначности, tenant/link inconsistencies. Только чтение с access log и fail-closed поведением. Максимум 1000 строк каждого типа с предупреждением об усечении.

## Миграция и ограничения

`drizzle/0014_treatment_cycle_foundation.sql` — только новая миграция. Применённая история 0000–0003 не изменена. Новые уникальные индексы создаются до ссылающихся FK. Client-составляющие новых межтабличных FK отложены до commit, чтобы атомарный merge мог перенести весь граф без промежуточного нарушения связи. Studio row lock сериализует изменения origin graph.

Deferrability и constraint triggers — ручные SQL-дополнения, отсутствующие в Drizzle snapshot. Сохранять их при будущих изменениях, проверять миграционные и интеграционные тесты.

Никаких угадываний циклов по старому `clients.clientStatus`: автоматических преобразований 0. Отчёт не является завершённым backfill. Нет production-миграции, seed или merge PR.

Пока нет transition commands, optimistic concurrency enforcement при редактировании, stage history, pipeline board, atomic booking/hold, денежных allocations, business logic Total Face и Remover. `version` и snapshots — поля хранения, а не доказательство реализации этих workflows. Package shell допускает незаполненный draft; atomic создание ровно трёх зон относится к 8.1. Calendar protections — Phase 5; финансы — Phase 6.

## Проверки

Локальные 160 unit/integration и 4 migration tests прошли. Миграционный тест сохраняет legacy client/service/visit/procedure, оставляет cycle_id NULL и новые таблицы пустыми; fresh/upgrade/repeat сходятся. Новые проверки охватывают зоны, timestamps, origin cycles, service mapping, tenant/client links, multi-cycle visit, procedure consistency, merge, RBAC и отказ access log.

`tests/e2e/treatment-cycles.spec.ts` проверяет Owner-report на ширине 390px, сохранность старого визита и запись access log. CI должен дополнительно подтвердить PostgreSQL 17, browser suite, typecheck/lint/build на точном head PR.

Следующий шаг: **3.2 — domain commands переходов 21 стадии, guards, event/history и UI**, поверх общих idempotency/audit/RBAC boundaries.
