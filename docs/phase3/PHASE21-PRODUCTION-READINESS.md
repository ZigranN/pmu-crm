# PHASE 21 — PRODUCTION READINESS & DEPLOYMENT REHEARSAL REPORT

**Document ID:** `PHASE21-PRODUCTION-READINESS`  
**Date:** 2026-11-03  
**Role:** Senior Staff Engineer / SRE / Release Engineer  
**Status:** COMPLETE (Rehearsal Executed, Audit Completed)  
**Recommendation:** `PRODUCTION NO-GO` (Pending Real Production Source Export, Git Release Artifact Staging, and Production Secrets Provisioning)

---

### Executive Summary

В рамках Фазы 21 проведена всесторонняя репетиция готовности системы PMU CRM к производственной эксплуатации (Production Readiness Rehearsal). Проверена воспроизводимость сборки, целостность базы миграций, механизмы резервного копирования и аварийного восстановления (Disaster Recovery), идемпотентность и безопасность миграционного пайплайна (Phase 19), надёжность фоновых воркеров (Outbox Pattern), изоляция арендаторов (Tenant Isolation), криптографическая защита согласий, мониторинг и сквозные регрессионные тесты.

Все тесты и репетиции выполнены в изолированном тестовом контуре без обращения к production-окружению и без модификации боевых данных.

---

### 1. Release Inventory & Git Integrity

#### 1.1 Отслеживаемые и неотслеживаемые компоненты
- **Git Branch:** `main...origin/main`
- **Модифицированные отслеживаемые файлы (80 файлов):**
  - Схемы и связи базы данных (`src/db/schema.ts`, `src/db/relations.ts`).
  - Ролевая политика, сессии, контекст и области видимости (`src/server/auth/`, `src/server/services/`).
  - Интерфейс и компоненты (`src/app/`, `src/components/`, `src/features/`).
  - Миграционный журнал (`drizzle/meta/_journal.json`).
  - Конфигурация тестов (`vitest.config.mts`, `package.json`).
- **Критичные локальные артефакты, существующие как untracked (требующие включения в будущий Release Commit):**
  - Миграции Drizzle: `drizzle/0021_*.sql` – `drizzle/0038_freezing_spyke.sql` (18 файлов).
  - Снапшоты метаданных: `drizzle/meta/0021_snapshot.json` – `drizzle/meta/0038_snapshot.json` (18 файлов).
  - Доменные модули: `src/features/ledger/` (полностью), `src/features/operations/` (полностью).
  - Модули миграции и DR: `src/features/migration/`, `scripts/backup-*.mjs`, `scripts/restore-*.mjs`, `scripts/verify-disaster-recovery.mjs`, `scripts/migration.ts`.
  - Модульные и интеграционные тесты: `tests/unit/daily-payment-report.test.ts`, `tests/integration/disaster-recovery-rehearsal.test.ts`, `tests/integration/migration-pipeline.test.ts` и др.
  - Документация: `docs/phase3/PHASE20-TRACEABILITY.md`, `docs/disaster-recovery.md`.
- **Файлы, категорически запрещённые к включению в Release Artifacts:**
  - Локальные дампы базы данных: `backups/postgres/*.dump`, `backups/postgres/*.sha256`.
  - Временные тестовые логи и артефакты: `test-results/`, `playwright-report/`, `.turbo/`, `.next/`.
  - Файлы локальных переменных окружения: `.env`, `.env.local`, `.env.*.local`.

#### 1.2 Оценка воспроизводимости сборки из чистого Git
- **Статус:** `FAIL / BLOCKED for pure git checkout`
- **Причина:** Если клонировать репозиторий с удалённого origin без локально добавленных файлов (миграции 0021–0038, модули ledger и operations), приложение не сможет применить миграции выше 0020 и скомпилировать новые маршруты.
- **Действие:** Перед релизом необходимо сформировать официальный релизный коммит/тег, включающий все проверенные фазовые артефакты.

---

### 2. Environment & Secrets Audit

#### 2.1 Таблица переменных окружения

| VARIABLE | PURPOSE | REQUIRED | ENVIRONMENT | VALIDATION | SECRET |
| :--- | :--- | :---: | :---: | :--- | :---: |
| `DATABASE_URL` | Подключение к PostgreSQL с пулом соединений | **YES** | Server / Runtime | PostgreSQL URI schema | **YES** |
| `BETTER_AUTH_SECRET` | Подпись сессий, кук и fallback-шифрование | **YES** | Server / Runtime | String (min 32 chars) | **YES** |
| `BETTER_AUTH_URL` | Базовый URL для аутентификации и callback | **YES** | Server / Runtime | Valid URL | NO |
| `NEXT_PUBLIC_APP_URL` | Публичный URL приложения для клиентского роутинга | **YES** | Client & Server | Valid URL | NO |
| `ENCRYPTION_KEY` | Мастер-ключ AES-256-GCM для защиты OAuth-токенов | **RECOMMENDED** | Server / Runtime | 32-byte hex/string | **YES** |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Выделенный ключ шифрования токенов Google | NO (Fallback) | Server / Runtime | 32-byte hex/string | **YES** |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID для интеграции Google Calendar | NO (Opt) | Server / Runtime | Non-empty string | NO |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret для интеграции Google Calendar | NO (Opt) | Server / Runtime | Non-empty string | **YES** |
| `CLOUDINARY_CLOUD_NAME` | Аккаунт Cloudinary для защищённых медиа | **YES** | Server / Runtime | Non-empty string | NO |
| `CLOUDINARY_API_KEY` | API Key для защищённого хранилища медиа | **YES** | Server / Runtime | Non-empty string | **YES** |
| `CLOUDINARY_API_SECRET` | API Secret для генерации signed URL | **YES** | Server / Runtime | Non-empty string | **YES** |
| `OPENAI_API_KEY` / `AI_API_KEY` | API-ключ для LLM Copilot (GPT-4o-mini) | NO (Opt) | Server / Runtime | Non-empty string | **YES** |
| `WORKER_SECRET` | Токен авторизации внутреннего эндпоинта `/api/internal/jobs` | **YES** | Server / Cron | String (min 32 chars) | **YES** |
| `NODE_ENV` | Режим работы среды (`production` / `test` / `development`) | **YES** | Runtime | `production` \| `test` | NO |

#### 2.2 Проверка Fail-Fast и защита от Development Defaults
- В модуле `src/lib/env.ts` реализована строгая Zod-валидация серверных и клиентских переменных.
- В продакшн-режиме (`NODE_ENV=production`) не допускается подстановка дефолтных тестовых ключей; при отсутствии обязательных переменных приложение завершает инициализацию с кодом ошибки (Fail-Fast).
- В `/src/app/api/internal/jobs/route.ts` эндпоинт фонового воркера возвращает `503 Worker not configured`, если `WORKER_SECRET` отсутствует или короче 32 символов.

---

### 3. Reproducible Build

- **Node.js версия:** v22.x (соответствует engines `node: ">=22.22.2 <23"`).
- **Пакетный менеджер:** npm с фиксированным `package-lock.json`.
- **TypeScript:** `npm run typecheck` — 0 ошибок.
- **ESLint:** `npm run lint` — 0 ошибок и предупреждений.
- **Next.js Production Build (`npm run build:test`):**
  - Next.js 16.2.6 (Turbopack).
  - Скомпилирован 31 статический и динамический маршрут.
  - Клиентский бандл проверен: тестовые фикстуры, серверные секреты и внутренние утилиты не просочились в клиентский код.
  - Отсутствуют dev-only зависимости в runtime-бандле.

---

### 4. Database Migration Readiness

- **Количество SQL-файлов миграций:** ровно 39 файлов (`0000_windy_the_watchers.sql` – `0038_freezing_spyke.sql`).
- **Количество записей в журнале:** ровно 39 записей в `drizzle/meta/_journal.json`.
- **Количество снапшотов:** ровно 39 файлов (`0000_snapshot.json` – `0038_snapshot.json`).
- **Head миграций:** `0038_freezing_spyke`.
- **Миграция `0039`:** отсутствует.
- **Schema Drift:** Проверено скриптом `tests/phase02-pg-verify.mjs`:
  - 25/25 проверок пройдено.
  - 0 реальных расхождений схемы (True drift count = 0) против канонического `0038_snapshot.json`.
- **Воспроизводимость на пустой БД:** Подтверждена в скриптах `verify-disaster-recovery.mjs` и `verify-migration.mjs` — накатывание всех 39 миграций на чистую схему выполняется за < 500 мс без ошибок.

---

### 5. Backup & Disaster Recovery Rehearsal (Phase 18)

Выполнена автоматическая репетиция катастрофоустойчивости (`npm run ops:verify`):
1. **Создание логического бэкапа (`ops:backup:pg`):**
   - Успешно сформирован канонический дамп PostgreSQL (`.dump`) с расчетом контрольной суммы SHA-256.
2. **Восстановление в чистую БД (`ops:restore:pg`):**
   - Успешное восстановление с проверкой SHA-256 integrity.
   - 100% сохранение всех связей: студии, клиенты, медицинские ревизии, циклы, визиты, протоколы процедур, проводки леджера, транзакции, диалоги, сообщения, настройки Google Calendar.
3. **Восстановление медиа-архива (`ops:backup:media`, `ops:restore:media`):**
   - Проверено 2/2 файлов манифеста.
   - Полная сохранность цифровых доказательств согласий (`signed_pdf_sha256`) и клинических фотографий.
4. **Тестирование механизмов безопасности (Negative Contract Testing):**
   - Попытка деструктивного восстановления без флага `--confirm` штатно заблокирована (`RESTORE_SAFETY_REFUSAL`).
   - Повреждённый дамп с несовпадающим SHA-256 отклонён с ошибкой `INTEGRITY_MISMATCH`.
   - Повреждённый медиафайл отклонён по манифесту SHA-256.
5. **Показатели RPO / RTO:**
   - *Локальная репетиция (Synthetic Rehearsal):* Время создания бэкапа — 189 мс, время полного восстановления — 392 мс.
   - *Заявленные цели для Production (SLA Targets):*
     - RPO (PostgreSQL): $\le 1\text{ час}$ (почасовые снимки + WAL-архивирование).
     - RTO (PostgreSQL): $\le 1\text{ час}$ (автоматизированное восстановление).
     - RPO / RTO (Медиа и согласия): RPO $\le 1\text{ час}$, RTO $\le 2\text{ часа}$.

---

### 6. Migration Cutover Rehearsal (Phase 19)

Выполнена репетиция миграционного пайплайна (`npm run migration:dry-run` и `npm run migration:verify`):
- **Текущий статус источника данных:**
  `REAL PRODUCTION SOURCE EXPORT: NOT AVAILABLE`
- **Репетиция на канонических репрезентативных фикстурах:**
  - `DRY-RUN`: Проведена полная валидация, детерминированный маппинг сущностей, расчет контрольной суммы (Input Checksum: `1323ce...`), сверка финансового баланса: Legacy Expected = 0 EUR, Imported Ledger = 0 EUR, Difference = 0 EUR (`RECONCILED`).
  - `APPLY`: Первый прогон создал 3 клиентов, 5 циклов, 1 визит, 4 проводки леджера.
  - `IDEMPOTENCY`: Повторный запуск того же датасета не создал ни одного дубликата (0 дублей).
  - `CONCURRENCY`: Параллельный запуск двух воркеров миграции в реальном PostgreSQL обработан детерминированно без дедлоков и гонок.
  - `DR ROLLBACK`: Проверено создание контрольной точки до миграции и мгновенный откат схемы/данных через Phase 18 restore.
- **Блокер:** Реальный переход на новую CRM заблокирован до момента предоставления экспорта реальной базы старой CRM.

---

### 7. Workers & External Integrations

- **Outbox Worker (`src/server/events/worker.ts`):**
  - Поддерживает транзакционную модель публикации событий (Outbox Pattern).
  - Идемпотентность выполнения задач гарантируется уникальными ключами и статусами `pending` $\to$ `processing` $\to$ `completed` / `dead`.
  - Механизм Lease Recovery: при падении воркера истекшие блокировки (`lease_until`) автоматически перехватываются при следующем цикле.
  - Dead-letter handling: задачи с превышением лимита попыток (`max_attempts`) переводятся в `dead` без блокировки очереди.
- **Google Calendar Sync (`src/features/google-calendar/`):**
  - Ошибки внешнего API Google изолированы: при сбое авторизации статус соединения переходит в `needs_reauth`, не нарушая работу локального календаря CRM.
  - Токены защищены шифрованием `enc:v1:`.
- **AI Copilot & Guardrails (`scripts/run-ai-evals.ts`):**
  - 11/11 тестов пройдено.
  - 4/4 попыток атак (prompt injection на обход медицинского допуска, подделка согласий, несанкционированные возвраты средств, автономная отправка сообщений) успешно заблокированы детерминированными гардами.
  - 0 галлюцинаций в ответах.

---

### 8. Security & Privacy Readiness

- **Better Auth & Сессии:** Сессии проверяются через `requireAuthenticatedUser()`, куки защищены `HttpOnly`, `Secure` (в production), `SameSite=Lax`.
- **Tenant Isolation (Multi-Studio):** Каждый запрос на чтение/запись жестко ограничен `studioId` активного контекста. Прямой доступ к чужой студии блокируется на уровне SQL-условий и RBAC-проверок.
- **Неизменяемость медицинских решений и согласий:**
  - Медицинский допуск (`MedicalClearance`) — исключительно решение врача/мастера; триггеры базы данных запрещают мутацию подписанных медицинских ревизий.
  - Согласие (`CycleConsent`) привязано к конкретному циклу и зоне; повторное использование запрещено; подписанный PDF зафиксирован SHA-256 хешем и триггером неизменяемости.
- **Финансовый леджер (Ledger):** Модель только для добавления (Append-only); отмены и корректировки выполняются только через компенсирующие проводки (`REFUND`), что гарантирует аудит баланса.
- **GDPR / Privacy (Phase 17):** Реализованы экспорт данных субъекта (DSAR) и деперсонализация (`anonymizeClientData`) с очисткой PII и сохранением целостности финансовой отчетности.

---

### 9. Health, Monitoring & Incident Response

- **Эндпоинты мониторинга:**
  - `/api/health?mode=liveness` — мгновенная проверка отзывчивости процесса (HTTP 200).
  - `/api/health?mode=readiness` — проверка подключения к PostgreSQL, латентности и текущего head миграций (`0038_freezing_spyke`) (HTTP 200 / 503).
  - `/api/health` — комплексный статус системы: готовность БД, состояние Outbox (лаг, количество зависших задач), статус интеграции Google Calendar и AI Copilot.
  - `/api/metrics` — операционные метрики с авторизацией через `WORKER_SECRET`.
- **Операционные регламенты (Runbooks):**
  - Документ `docs/disaster-recovery.md` содержит детальные инструкции по восстановлению для инцидентов SEV1, SEV2, SEV3.
  - Разграничены права доступа и команды операторов для процедур бэкапа, восстановления, ротации ключей и ручного перезапуска зависших очередей.

---

### 10. Smoke Tests & Full Regression Summary

Все 9 уровней проверок успешно пройдены на текущем коде:

| Проверка | Команда | Результат | Метрики / Объем |
| :--- | :--- | :---: | :--- |
| **Typecheck** | `npm run typecheck` | **PASS (0)** | 0 ошибок TypeScript (`tsc --noEmit`) |
| **Lint** | `npm run lint` | **PASS (0)** | 0 предупреждений и ошибок ESLint |
| **Migration Integrity** | `npm run test:migrations` | **PASS (0)** | 4/4 TAP-подтеста пройдено |
| **Schema Drift Check** | `node --test tests/phase02-pg-verify.mjs` | **PASS (0)** | 25/25 проверок, 0 schema drift против `0038_snapshot.json` |
| **AI Safety Evals** | `npm run test:ai-evals` | **PASS (0)** | 11/11 кейсов, 4 атаки заблокировано, 0 галлюцинаций |
| **Vitest Unit & Integration** | `npm test` | **PASS (0)** | 80 файлов / 995 тестов пройдено |
| **PostgreSQL Integration** | `npm run test:postgres` | **PASS (0)** | 53 файла / 730 тестов пройдено |
| **Next.js Production Build**| `npm run build:test` | **PASS (0)** | 31 маршрут успешно скомпилирован (Turbopack) |
| **Playwright E2E** | `npm run test:e2e` | **PASS (0)** | 44/44 E2E-теста в Chromium пройдено |

---

### 11. Quality Gates Assessment

| Quality Gate | Статус | Обоснование |
| :--- | :---: | :--- |
| **1. Release Inventory** | **FAIL** | 80 модифицированных и десятки untracked файлов не зафиксированы в релизном Git-коммите |
| **2. Git Reproducibility** | **BLOCKED** | Чистый `git clone` с origin не содержит миграций 0021–0038 и новых модулей |
| **3. Environment Readiness** | **PASS (Rehearsal)** | Контракт переменных окружения и fail-fast валидация полностью верифицированы |
| **4. Database Migrations** | **PASS** | 39 миграций, 0 дрифта схемы, чистая накатка на пустую БД подтверждена |
| **5. Backup & DR Readiness** | **PASS** | `ops:verify` подтвердил 100% восстановление БД, медиа и устойчивость воркеров |
| **6. Migration Cutover** | **BLOCKED** | Реальный экспорт данных (`REAL PRODUCTION SOURCE EXPORT`) отсутствует |
| **7. Workers & Outbox** | **PASS** | Защита от дублей, регенерация lease и dead-letter подтверждены |
| **8. External Integrations** | **PASS (Mocks/Staging)** | Google Calendar и AI Copilot изолированы и защищены гардрейлами |
| **9. Security & Privacy** | **PASS** | RBAC, tenant isolation, неизменяемость медицинских карт и GDPR DSAR работают |
| **10. Health & Monitoring** | **PASS** | Эндпоинты `/api/health` (liveness/readiness) и runbooks готовы |
| **11. Full Regression Suite**| **PASS** | Все 9 наборов тестов (включая 995 Vitest, 730 Postgres, 44 E2E) пройдены на 100% |

---

### 12. Production Blockers & Risk Assessment

| BLOCKER | SEVERITY | EVIDENCE | REQUIRED ACTION | OWNER / DEPENDENCY |
| :--- | :---: | :--- | :--- | :--- |
| **Missing Real Production Source Export** | **CRITICAL (BLOCKER)** | Вывод CLI: `PRODUCTION SOURCE DATA NOT AVAILABLE IN CURRENT ENVIRONMENT` | Предоставить валидный JSON/SQL/CSV-дамп из старой CRM для проведения реального cutover | Client / Studio Operations |
| **Git Release Artifacts Untracked** | **HIGH (BLOCKER)** | `git status` показывает незакоммиченные миграции 0021–0038, схемы и тесты | Выполнить контролируемый `git add` / `git commit` / `git tag` для создания официального release baseline | Release Engineer / Lead Dev |
| **Production Secrets Provisioning** | **HIGH (BLOCKER)** | Локальные тесты используют `pmu_test:local-only` и fallback-ключи | Настроить production secret manager (Vercel / Cloudflare / AWS) с реальными ключами | SRE / DevOps / Client |
| **Domain DNS & SSL Provisioning** | **MEDIUM** | Продакшн URL не привязан к боевому домену студии | Настроить DNS CNAME/A записи и верифицировать SSL сертификаты | DevOps / Client |

---

### 13. Final GO / NO-GO Recommendation

На основании результатов репетиции:
- **Архитектурная и кодовая готовность:** 100% PASS. Все тесты, схемы, защитные инварианты и механизмы DR функционируют безупречно.
- **Операционная готовность к боевому деплою:** **PRODUCTION NO-GO**.

**Причина решения NO-GO:**
1. Отсутствует реальный экспорт данных старой CRM для боевой миграции.
2. Исходный код фаз 1–20 не зафиксирован в виде релизного коммита в удалённом репозитории.
3. Продакшн-секреты и боевая база данных PostgreSQL ещё не сконфигурированы в целевом облаке.

**Последовательность действий для перехода к Production:**
1. Предоставить боевой файл экспорта данных старой системы.
2. Зафиксировать проверенные изменения в Git (Release Tag `v1.0.0-rc1`).
3. Развернуть целевую базу данных PostgreSQL 17 в продакшн-окружении и применить миграции `0000`–`0038`.
4. Выполнить `npm run migration:apply` с боевым файлом данных.
5. Провести финальную сверку финансового баланса и переключить трафик.

---

**ИТОГОВЫЙ СТАТУС РЕПЕТИЦИИ:**
`PHASE 21 COMPLETE`
`PRODUCTION NO-GO`
