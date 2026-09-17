# PMU CRM — анализ выполненной работы и оставшегося объёма

Дата проверки: **15.09.2026**. Проверенный код: `d9553dc1d71d09a77135e5bb185de3b07750c160`, ветка `codex/phase-3-cycle-reassessment`, [PR №18](https://github.com/ZigranN/pmu-crm/pull/18). Эталон: [Master Specification 1.1](MASTER-SPECIFICATION.md), исходное ТЗ от 12.09.2026 плюс утверждённое расширение AI. Код в рамках аудита не изменялся; обновлена документация.

Повторная сверка **17.09.2026**: локальный runtime commit, GitHub main, статусы PR №1–18 и успешный CI не изменились. Dependency audit относится к срезу 15.09.2026; повторного сканирования зависимостей при этой сверке не выполнялось.

## 1. Вывод

Построены проверяемые основы CRM и значительная часть процесса до записи на процедуру: права, клиентская идентичность, каталог/цены, циклы, консультационные решения, напоминания, перенос, повторная оценка и Lost. Это полезная работа, которую следует продолжать, а не переписывать.

**Полная CRM по ТЗ ещё не готова к запуску.** Нет работающего Calendar Engine/atomic booking, полного ledger, медицинского допуска и подписанного PDF, PMU sessions/control, Total Face/Remover workflow, реальной переписки, AI, Google Calendar и общего Lead → Refresh E2E. Наличие таблиц или 21 названия стадии эти процессы не заменяет.

Нельзя честно вывести процент готовности из количества PR, таблиц или тестов: самые крупные интеграционные модули ещё впереди. Ни один полный пакет P0 §74 пока не принят как production E2E.

## 2. Что именно проверено

Сверены Git history/рабочее дерево, GitHub main и PR №1–18, CI окончательного коммита, схема и миграционные snapshots 0000–0019, структура feature/server/API/UI/test модулей, действующие команды циклов/консультаций, mutation hooks, RBAC/scopes/audit, uploads/consent, pricing/offers, чтение appointments/payments, реестр worker handlers и release acceptance. Существующие roadmap/baseline использованы как карта, а не как доказательство наличия кода.

Это статический аудит кода и проверенных автоматических тестов, **не penetration test и не проверка реальных данных/интеграций**. Neon, Cloudinary account configuration и Vercel deployment не обследовались и не изменялись. Актуальность конфигурации сайта, применённых SQL и реальных секретов не подтверждена. Нового полного тестового прогона ради документа не было: использован успешный CI точно того же неизменённого runtime-кода.

## 3. GitHub и доказательства

- GitHub main: `4ad7e7c0aa5872612c00542d6cc83ef95e3cde2a`.
- **PR №1–6 MERGED; №7–18 OPEN/DRAFT.** Изменения после Phase 1.3 находятся в цепочке draft PR и ещё не вошли в main.
- [CI PR №18](https://github.com/ZigranN/pmu-crm/actions/runs/34777824797): success, head `d9553dc…`; **typecheck, lint, build, 225 unit/integration, 4 migration, 18 Chromium tests**.
- 225 — тесты кода, не 225 принятых требований ТЗ. [Реестр §§76–79](ACCEPTANCE.md) по-прежнему содержит 125 отдельных требований release acceptance. Многие базовые свойства проверены на существующих командах, но их будущие booking/AI/finance сценарии не реализованы.
- В Chromium консультационные визиты и часть задач создаются fixtures. Нет доказанного бронирования реального слота, платежа, доставки WhatsApp или Google sync. Worker/time/concurrency дополнительно проверены интеграционно.
- Миграции 0014–0019 добавили cycles, историю/команды, консультации, follow-up tasks/revisions и review/closures. Их наличие и прохождение тестов **не доказывают применение в Neon**.
- Merge, миграции/seed Neon и deployment нами не выполнялись в текущем продолжении. Запрет пользователя сохраняется.

Подробный список PR и машинные данные: [evidence](AUDIT-EVIDENCE-2026-09-15.json). Перед будущим merge повторно проверять всю цепочку относительно актуального main; зелёный последний CI не заменяет merge rehearsal.

## 4. Выполненная работа по фазам

| Шаги | Что сделано | Граница готовности |
|---|---|---|
| 0.1–0.2 | Восстановленная migration chain, Node 22.22.2, Vitest/Playwright, изолированный PostgreSQL 17, CI | Проверен технический baseline; рабочая БД не считается мигрированной |
| 0.3–0.5 | Tenant context, защита основных чтений/мутаций, исправления master services, search, shell, повторяемый seed | Найден отдельный пробел generic upload; см. S0.2 ниже |
| 1.1–1.2 | OWNER/ADMIN/MASTER/AI_SYSTEM, ceilings/deny overrides, master scope, назначения и управление membership | Распространить те же ограничения на каждый новый domain command |
| 1.3 | Transactional audit, before/after/reason/actor, fail-closed sensitive access log, интерфейсы журналов | Нельзя считать все старые API автоматически охваченными; новые модули требуют новых событий |
| 1.4 | Idempotency receipts, payload hash, outbox/inbox, leases, retry/recovery | Только зарегистрированные внутренние handlers; production scheduler и внешние adapters не подтверждены |
| 2.1 | Каталог, зоны/техники, session models, price modes, legacy preservation | Не реализует расписание и процедуры |
| 2.2 | Master overrides, price resolver, immutable multi-zone Custom Offers | Нет срока условий и команды применения offer к cycle/ledger |
| 2.3 | Административная карта: язык, тип клиента, зоны, previous PMU, assigned/preferred master | Медицинский допуск отдельно, AI заполнение ещё отсутствует |
| 2.4–2.5 | Canonical contacts, duplicate review, concurrent create, merge, aliases, conflict choices, provenance | Merge протестирован на текущем графе; новые таблицы/интеграции должны расширять его |
| 3.1 | Treatment cycle одной зоны, package shell, appointment_cycles, snapshots/FK/version, legacy report | Отчёт не выполняет backfill; package shell не является Total Face |
| 3.2 | 21 стадия, командные guards, version/replay, timeline/board, ранние переходы | Поздние переходы намеренно блокируются без соответствующих доменных сервисов |
| 3.3 | Live qualification, правило двух лет с исключениями, completed-consultation evidence, пять outcomes, overdue task | Требует существующего completed appointment; настоящего Calendar booking ещё нет |
| 3.4a | Thinking +7×24h, задача повторной оценки на дату мастера, dedup/worker/recovery | Это задача CRM, не отправленное сообщение клиенту |
| 3.4b | Immutable перенос даты, reasons/comments, отмена старых задач, защита старых timers | Не выдаёт medical clearance и не меняет цену |
| 3.4c | Human reassessment, Lost, возобновление того же цикла через свежую qualification; permanent follow-up closures | Нельзя обходить Remover/package/procedure/payment; архивирования до 0019 требуют сверки |

## 5. Состояние ключевых модулей

| Модуль | Факт реализации | Что отсутствует / не принято |
|---|---|---|
| Schema/migrations | Проверяемая append-only история SQL и ключи существующих связей | Rehearsal реальных данных, ручной legacy mapping, финальный backfill |
| Auth/RBAC | Серверный actor/studio, основной capability/scope boundary | Отдельные upload/API gaps; security dependency review; полный role E2E будущих модулей |
| Clients/masters/services | CRUD, назначения, каталог, цены, дедуп/merge | Сквозное использование в booking/AI и финальном ledger |
| Medical | Анкета, права и история; оценка консультации/повторная qualification | Отдельный clearance record/revision, review_required при изменениях |
| Activity/audit | Существующие мутации и защищённые чтения журналируются | Единая timeline всех будущих доменов и полная release traceability |
| Media | Upload в Cloudinary, связи client/visit/procedure, архивирование | Private delivery, единый server validator, cycle/zone/healed/source/verification и stage requirements |
| Consents | Backend upload record и сохранение исходных файлов | Вкладка использует media UI; нет finger signature/PDF/version/hash/multi-zone/review2y |
| Calendar/appointments | Legacy tables и scoped queries | Availability, atomic booking, occupancy, lifecycle UI, holds, no-show/reschedule protocol |
| Cycles/deals | До-процедурная ветка с защищёнными переходами | Offer terms; полноценный путь session1 → session2 → control → completed → refresh |
| Total Face | Package shell и независимые зоны на уровне схемы | Atomic 3-cycle creation, 1400/500–400–500, сроки, allocations, отказ зоны |
| Remover | removal_required создаёт связанный child cycle, оригинал сохраняется | Сессии, 100/visit, фото, review, Repeat/Ready/Wait/Stop, разрешённый возврат original PMU |
| Payments | Legacy payments/transactions + защищённое чтение | Posting ledger, split/credit/allocation/refund/reversal, баланс и daily report |
| Conversations | Нет полноценного модуля | Inbox, channels, verified webhooks, delivery state, inbound media, templates |
| Automations | 4 internal handlers: client created, stage receipt, decision task, follow-up task | Confirmation/pre-care/post-care/check-in/healed/review/refresh и внешняя доставка |
| AI | Архитектурное ТЗ, role restrictions, evaluation plan | Runtime/orchestrator/tools/policy/RAG/memory/takeover/evals/observability отсутствуют |
| Google Calendar | Нет integration module | OAuth, two-way sync, private Busy, collisions, token/channel recovery |
| Dashboard/mobile | Навигация, текущие формы, отдельные audit/jobs views | Today/Week, 13 категорий Needs Attention, полный mobile workflow |
| Ops/privacy | Базовые guards и архивирование | Нет ops runbooks, export, retention/anonymisation, доказанного backup restore |
| E2E | 18 Chromium tests текущих функций | Нет полного Human/AI PMU path, Total Face/Remover acceptance и sandbox integrations |

## 6. Дефекты, долги и риски — не маскировать зелёным CI

### S0.1 — зависимости, до публичного запуска

`npm audit --json` на этом lockfile: **58 отмеченных пакетов: 1 critical, 42 high, 10 moderate, 5 low**. `--omit=dev`: **45 пакетов: 1 critical, 29 high, 10 moderate, 5 low**. Эти числа нельзя складывать: второй набор входит в первый; транзитивные цепочки повторяют причины и это не число уникальных эксплойтов.

Среди direct dependencies отмечены Next.js, Better Auth, next-cloudinary, shadcn. Для части пакетов `fixAvailable=false` означает отсутствие предложенного npm автоматического исправления, а не доказательство отсутствия исправленной версии вообще. Условия применимости advisory различны: например Windows-specific issue не доказывает уязвимость Vercel/Linux, а Better Auth plugins из advisory могут не использоваться. Нужны ручной triage, совместимое обновление, тесты и зафиксированное остаточное решение. `npm audit fix --force` не выполнять вслепую. В CI сейчас нет dependency audit gate.

### S0.2 — upload boundary, приоритет P1

`src/app/api/upload/image/route.ts` проверяет только `getSession()`, который возвращает session. Нет активной studio membership, capability, resource scope, tenant folder или аудита загрузки. Есть ограничение 5MB и MIME prefix, но оно не заменяет авторизацию. Это подтверждённый статический gap, а не доказанный инцидент.

`src/features/media/server/service.ts::withMediaUpload` проверяет File/non-empty и ссылки, но не единый максимум размера/тип/содержимое; проверка браузерного компонента обходится прямым action/API вызовом. Upload endpoints возвращают raw `error.message`, provider errors логируются без общей redaction policy. Унифицировать все входы, включая consent; добавить отрицательные integration/HTTP tests.

### S0.3 / Phase 4.2 — private media

Cloudinary helper использует обычный upload и сохраняет `secure_url`; в коде нет подтверждённого authenticated/private delivery и выдачи временного scoped URL. HTTPS не является контролем доступа. Реальные cloud settings не проверялись. До использования настоящих клиентских/медицинских фото требуется отдельный private-storage contract, проверка URL вне CRM и recovery cleanup.

### Остальной технический долг

- Документация ранее смешивала старые даты/коммиты и новые дополнения. Текущий аудит заменяет устаревшие сведения о состоянии; исходные baseline остаются историческими.
- Legacy `clientStatus` отделён от cycle stage; `inspectLegacyCycles` только инвентаризирует до 1000 visits/1000 procedures. Автоматическое объединение курсов без доказательств недопустимо.
- Follow-up использует точные +7×24h, тогда как срок предложения в ТЗ «ориентировочно неделя». Нельзя смешивать это с автоматическим истечением цены. Default consultation-decision SLA 24h — настройка реализации, не утверждённая норма салона.
- List limits: board 500, consultation history 100, review/schedule history 50; нужна pagination для больших данных, не выдавать ограниченный список за полную историю.
- Часть schema integrity реализована вручную в SQL triggers и не полностью описана Drizzle snapshot. При новых migration необходимо сохранять и проверять triggers, не только generated diff.
- Цикловые команды/формы стали плотными по объёму: выделять повторяющиеся contracts/guards аккуратно при следующем изменении, без переписывания проверенных модулей ради стиля.
- Calendar/ledger/package/AI не должны реализовывать второй путь мутаций. Сохранить общий command boundary и проверку актуальных прав непосредственно перед эффектом.
- Production worker schedule, разрешённые URLs, callbacks, provider secrets, резервные копии и доступность storage ещё не подтверждены. Опубликованные ранее в переписке секреты нужно заменить перед запуском; сами значения в отчёт не включены.

## 7. Что делать дальше

**S0.1/S0.2 security hardening → 3.4d offer terms → Phase 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15.** Private media нельзя отложить до использования реальных данных. AI/Google интегрируются после общего booking service; финальная приёмка включает их совместную работу.

[Полное ТЗ остатка](REMAINING-SPECIFICATION.md) содержит 52 детальных шага Phase 4–15, отдельно S0, 3.4d, интеграционные остатки и 5 P2-шагов. Для каждого шага указаны конкретные файлы, требования, критерии, тесты и зависимости. [Матрица 80 разделов](COVERAGE.md) и [чек-лист](IMPLEMENTATION-CHECKLIST.md) актуализированы. Phase 16 — P2 после рабочего P0, не замена обязательным платежам/export/privacy/Google.

## 8. Что требуется от владельца и что можно выполнить самостоятельно

Разработку, additive migrations, mocks, fixtures, тесты, CI, draft PR, документацию и подготовку deployment rehearsal можно вести самостоятельно в согласованном объёме. Доступ к рабочей БД для этого не требуется.

К зависимым этапам владелец должен утвердить: правила цены/срока offer и paid/free correction; anchors контроль/refresh и счётчик напоминаний; рабочие часы/отпуска/длительности; clinical/consent тексты и approved pre/post-care/FAQ; языки и шаблоны; retention/backup цели. Для sandbox integrations нужны Meta/WhatsApp/IG/FB, Google OAuth/calendars, Cloudinary private storage и OpenAI project с лимитами. Передавать секреты через защищённую конфигурацию, не в чат.

Отдельно требуется разрешение на будущие merge, применение Neon migrations, изменение live integrations и deployment: текущий запрет этими документами не отменяется. Владелец принимает бизнес-результат; мы предоставляем конкретный diff, тестовые сценарии и доказательства.
