# Phase 0.2 — тестовая инфраструктура и CI

> Исторический отчёт шага 0.2. P0-ACCESS-01/02 исправлены в 0.3; актуальные результаты: [ACCESS-BASELINE.md](ACCESS-BASELINE.md). Ограничения удалённого CI и браузера сохраняются.

Дата: 12.09.2026. Node закреплён на 22.22.2. Изменения локальные; workflow ещё не запускался на GitHub.

## Что добавлено

- Vitest с alias `@`, отдельными unit/integration/regression suites и тестовыми адаптерами. HTTP и Cloudinary по умолчанию заблокированы тестовыми mocks; секреты приложения не загружаются.
- Фабрики синтетических студий/клиентов с уникальными идентификаторами; настоящие миграции перед DB-тестами.
- Два backend: локальный PGlite и PostgreSQL через postgres-js. `test:postgres` требует явный TEST_DATABASE_URL, ограниченный loopback и именем pmu_test / pmu_test_*. DATABASE_URL приложения не используется. Очистка удаляет только созданные fixtures.
- Проверки хранения клиентов: create/read/update/delete, фильтр двух студий, FK, rollback. Это проверка ORM/БД, не доказательство авторизации всех Server Actions.
- Проверка настоящей конфигурации Better Auth: регистрация, cookie/session, отклонение неверного пароля, отсутствие анонимной сессии.
- Playwright: браузерные проверки перенаправления на login и обработки ошибки входа (HTTP-ответ входа здесь mock). Отдельные HTTP-проверки собранного Next-приложения не требуют браузера.
- `build:test` задаёт только синтетические env. Эта сборка предназначена для проверки и не должна развёртываться как рабочая CRM.
- GitHub Actions: npm ci → typecheck → lint → migration/Vitest tests на PostgreSQL 17 → build:test → Chromium → Playwright. Нет пропусков PostgreSQL при ошибке конфигурации. Права workflow: contents:read; отчёты ошибок хранятся семь дней.
- compose.test.yml для одноразовой PostgreSQL 17 в tmpfs, без подключения Neon.

## Известные дефекты — не исправлены

| ID | Проверяемое требование | Текущий результат | Исправление |
|---|---|---|---|
| P0-ACCESS-01 | Пользователь без членства не получает чужую студию | Ожидаемое падение: getCurrentStudioId использует fallback | 0.3 |
| P0-ACCESS-02 | Неавторизованный поиск не читает клиентов | Ожидаемое падение: searchClientsAction читает без session guard | 0.3 |

Эти тесты исполняются через `test.fails`, а не skip. Неожиданный успех делает suite красным: при исправлении нужно убрать `.fails` и проверить соответствующее требование обычным тестом. Зелёный инфраструктурный CI с двумя expected failures не означает безопасную или готовую к выпуску CRM. Другие дефекты аудита остаются открытыми; этот небольшой набор их не покрывает полностью.

## Проверки и границы доказательств

- Чистая установка npm ci на Node 22.22.2: PASS.
- HTTP smoke собранного приложения: 2 PASS (redirect/login/anonymous session).
- typecheck: PASS на Node 22.22.2.
- lint: PASS.
- Миграционные тесты: 4 PASS.
- Vitest: 8 PASS и 2 EXPECTED FAIL (перечислены выше), без skipped.
- build:test: PASS с синтетическими env.
- Браузерные проверки: BLOCKED до выполнения assertions. Chromium завершился при запуске с `MachPortRendezvous ... Permission denied` в macOS sandbox. Это не успешный E2E.
- PostgreSQL 17 service / GitHub Actions: NOT RUN. Docker daemon локально не запущен; GitHub CLI не авторизован. Интеграционный прогон выполнен на PGlite. Серверная ветка и CI требуют отдельного фактического прогона перед окончательной приёмкой 0.2.

Команды воспроизведения находятся в [README](../../README.md). Для первого удалённого прогона нужны отправка ветки на GitHub и доступ к Actions. Production deploy, запуск seed и изменения данных Neon в этот шаг не входят и не выполнялись.

## Документация инструментов

Использованы [Vitest test.fails](https://vitest.dev/api/test#fails), [Playwright webServer](https://playwright.dev/docs/test-webserver) и [GitHub PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).

При npm ci audit сообщил о 19 dependency vulnerabilities, включая одну critical. Это отдельный открытый пункт проверки зависимостей; автоматический npm audit fix --force не выполнялся.
