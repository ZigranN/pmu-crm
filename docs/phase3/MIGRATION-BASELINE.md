# Phase0.1 — восстановление миграционной истории

Ветка: codex/phase-0-migration-baseline. Исходный commit:6ed762f. Проверка Neon выполнена 12.09.2026 внутри PostgreSQL READ ONLY transaction; данные клиентов, пароли/токены не выгружались.

## Восстановлено

- drizzle/0002_spicy_captain_midlands.sql: точный SQL из текущей schema и snapshot0001. SHA-256 совпал с уже применённым SQL в Neon:375530a134520709f555bcc994706cb44cbffbfdc4d0480f18c137ef9f64ae8d.
- drizzle/meta/0002_snapshot.json: regenerated snapshot с корректным prevId. Исходный snapshot UUID неизвестен; это восстановленная tooling metadata, не изменение SQL-history.
- Существующий journal, SQL0000/0001 и schema не переписаны. Хэши 0000/0001 также совпали с Neon.
- Все шесть nullable columns уже существуют в Neon. Повторно применять 0002 к Neon не требуется; никаких migrations/seed/DDL туда не отправляли.

## Проверки

npm run test:migrations:4/4 PASS, без пропусков:

1. Reader читает всю цепочку и hashes применённых SQL неизменны.
2. Каждый journal entry имеет snapshot с правильной связью и increasing timestamp.
3. Snapshot0002 отличается только шестью client columns.
4. Fresh migrate и upgrade от 0001 с клиентской записью сходятся; существующие поля/ID сохранены; новые columns nullable и writable; repeat migrate не меняет клиента или журнал.

Для локальной проверки использован PGlite — PostgreSQL WASM, две отдельные in-memory базы без DATABASE_URL и без доступа к Neon. Обычный initdb PostgreSQL14 был недоступен из-за ограничения shared-memory в рабочей среде. Не следует считать PGlite заменой будущим multi-connection booking/concurrency tests на PostgreSQL-сервере. Neon использует PostgreSQL17; его applied SQL hashes/catalog проверены read-only.

typecheck/lint: PASS. Build с dummy env: PASS. Тесты и dev dependency не меняют runtime бизнес-логику.

## Как повторить

npm ci
npm run test:migrations
npm run typecheck
npm run lint
npm run build — с валидно оформленными env, без production credentials для компиляционной проверки.

Тесты создают только embedded scratch engines и не читают DATABASE_URL. Общая DB-backed test infrastructure/CI — следующий 0.2. RBAC/доступ/seed дефекты аудита ещё не исправлены. Cloudinary/API credentials из переписки не сохранены в Git; Временный файл подключения удалён после read-only диагностики.
