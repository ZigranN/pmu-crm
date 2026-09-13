# Полный чек-лист PMU CRM — состояние на 13.09.2026

## Что означает «выполнено»

- [x] **Код шага реализован и проверен** — ограниченный объём конкретного шага присутствует в ветке `codex/phase-2-client-merge`, commit `eceed9c`.
- [ ] **Осталось выполнить** — целевой бизнес-сценарий не готов, даже если есть таблицы, enum, UI-заготовка или общий framework.
- Наличие кода, merge в main, применение миграции и проверка на рабочем сайте — разные состояния. Процент готовности по количеству шагов не вычисляется: сложность фаз неодинакова.

Основание: [рабочее ТЗ 1.1](MASTER-SPECIFICATION.md), [ROADMAP](ROADMAP.md), фактическое дерево исходников, baseline-документы и GitHub. Исходное ТЗ 1.0 от 12.09.2026 не подменено новым продуктом: редакция 1.1 учитывает согласованное расширение AI.

## GitHub, проверки и рабочая среда

- Текущая реализованная ветка: `codex/phase-2-client-merge`, `eceed9cdbb6a8110c24c983818fc7422570d69af`.
- GitHub main на момент запроса: `4ad7e7c0aa5872612c00542d6cc83ef95e3cde2a`.
- PR №1–6 объединены. PR №7–12 открыты как draft; это цепочка зависимых изменений, начинающаяся с Phase 1.4.
- [CI окончательного кода](https://github.com/ZigranN/pmu-crm/actions/runs/34758447526): typecheck, lint, test build, **150 unit/integration, 4 migration и 13 browser tests** прошли. PostgreSQL 17 и Chromium — тестовые окружения.
- Нового прогона тестов ради этого документа не выполнялось: использован проверенный прогон указанного commit. В этой задаче изменена только документация.
- [ ] Merge оставшихся PR не выполнен.
- [ ] Применение миграций до 0013 в Neon не подтверждено. Таблицу миграций рабочей базы в этой задаче не читали и не меняли.
- [ ] Состояние и версия Vercel deployment не проверены; работоспособность рабочего сайта нельзя выводить из CI.
- [ ] Активация scheduler/реальных providers и полная приёмка P0 не подтверждены.

| PR | Содержание | GitHub |
|---|---|---|
| [№1](https://github.com/ZigranN/pmu-crm/pull/1) | Restore migration history, add CI and enforce tenant read access | MERGED |
| [№2](https://github.com/ZigranN/pmu-crm/pull/2) | Protect mutation ownership and preserve master service assignments | MERGED |
| [№3](https://github.com/ZigranN/pmu-crm/pull/3) | Phase 0.5: repeatable seed and shared CRM navigation | MERGED |
| [№4](https://github.com/ZigranN/pmu-crm/pull/4) | Phase 1.1: studio role policy and protected registration | MERGED |
| [№5](https://github.com/ZigranN/pmu-crm/pull/5) | Phase 1.2: master assignment scope and Owner membership management | MERGED |
| [№6](https://github.com/ZigranN/pmu-crm/pull/6) | Phase 1.3: transactional audit and sensitive read journals | MERGED |
| [№7](https://github.com/ZigranN/pmu-crm/pull/7) | Phase 1.4: idempotent client commands and durable event worker | OPEN / DRAFT |
| [№8](https://github.com/ZigranN/pmu-crm/pull/8) | Phase 2.1: normalized service catalog and legacy preservation | OPEN / DRAFT |
| [№9](https://github.com/ZigranN/pmu-crm/pull/9) | Phase 2.2: master pricing and immutable Custom Offers | OPEN / DRAFT |
| [№10](https://github.com/ZigranN/pmu-crm/pull/10) | Phase 2.3: administrative client card and preferred master | OPEN / DRAFT |
| [№11](https://github.com/ZigranN/pmu-crm/pull/11) | Phase 2.4: client contact normalization and duplicate review | OPEN / DRAFT |
| [№12](https://github.com/ZigranN/pmu-crm/pull/12) | Phase 2.5: atomic client merge with aliases and preserved history | OPEN / DRAFT |

## Выполненные шаги разработки — Phase 0–2

Чекбокс относится к реализации шага для существующих модулей. Будущие домены и эксплуатационная приёмка остаются открытыми.

- [x] **0.1 Миграционная цепочка** — Восстановлена миграционная цепочка; проверяются fresh/upgrade/repeat и сохранение старых данных.
- [x] **0.2 Тестовая среда** — Node/test scripts, Vitest, Playwright, одноразовая PostgreSQL 17 и CI.
- [x] **0.3 Чтение и tenant context** — Session/membership/permission и tenant isolation; исключён fallback к чужой студии.
- [x] **0.4 Мутации и потеря услуг** — Целостность мутаций, связанных IDs, master services, медицинских и media/consent операций.
- [x] **0.5 Локальные дефекты UI/seed** — Общий CRM shell, мобильная навигация, исправления форм/поиска и повторяемый seed.
- [x] **1.1 Реальные роли** — OWNER/ADMIN/MASTER/AI_SYSTEM, legacy mapping, capability ceilings и deny overrides.
- [x] **1.2 Область доступа мастера** — Назначение мастера, история назначений, границы доступа к своим клиентам/данным и управление membership.
- [x] **1.3 Audit / access log** — Transactional audit с before/after/reason/actor; журнал выдачи чувствительных данных; Owner UI журналов.
- [x] **1.4 Idempotency / outbox / worker** — Idempotency receipts, inbox/outbox, leases/retry/dead letters/recovery. Реальный внутренний consumer пока client.created.v1; бизнес-автоматизации и providers ещё отсутствуют.
- [x] **2.1 Каталог** — Нормализованный каталог, зоны/техники, модели сессий, режимы цены, ссылки templates, сохранение legacy.
- [x] **2.2 Цены мастеров / Custom Offer** — Цены мастеров, общий price resolver и Custom Offer с неизменяемыми версиями. Привязки к циклам/ledger ещё нет.
- [x] **2.3 Административная карта** — Язык, источник, зоны интереса, new/returning, previous PMU со слов клиента, assigned/preferred master; разделение administrative/medical.
- [x] **2.4 Дедупликация** — Нормализация контактов, exact/possible review, защита concurrent create, явное решение по общим контактам.
- [x] **2.5 Merge** — Объединение текущих связей, aliases старых ID, conflict choices, provenance, audit, повтор запроса, сохранение медицинской истории.

## Что готово лишь частично

- **Medical:** анкета, доступ, audit и сохранённые после merge профили есть; clinical clearance, ревизии допуска и полный процесс Phase 4 отсутствуют.
- **Appointments/calendar:** есть legacy таблицы и защищённые чтения; нет slot engine, atomic booking, lifecycle UI и double-booking protection по ТЗ.
- **Payments:** таблицы и scoped reads есть; нет целевого ledger/posting/credit/refund/report workflow. LTV/visitCount при merge остаются legacy caches.
- **Media/consents:** upload и сохранение оригиналов при архивировании есть; private delivery, cycle/zone/stage requirements, подпись/PDF/версии/review ещё не готовы.
- **Automation:** очередь и worker framework есть; подтверждения, уход, check-in, отзывы, refresh и реальные отправки ещё отсутствуют.
- **AI:** роль технически ограничена; агент, OpenAI runtime, tools, KB/RAG, memory, takeover и dataset ещё не созданы. План dataset на 180 сценариев не является готовым dataset.
- **Mobile/timeline:** текущие формы протестированы на 390px, есть activity history; полный мобильный рабочий день и единая история всех будущих сущностей не готовы.
- **Merge:** выполнен для существующей схемы; новые cycles/packages/conversations/ledger обязаны добавлять свои связи в registry и тесты. Обычный список ищет текущие поля, поиск дублей учитывает контакты aliases.

## Оставшиеся шаги — полный перечень


### Phase 3 — treatment cycles и pipeline (§3,40–46)

- [ ] **3.1 Схема циклов** — см. [ТЗ шага 3.1](REMAINING-SPECIFICATION.md#step-3-1).
- [ ] **3.2 21 стадия** — см. [ТЗ шага 3.2](REMAINING-SPECIFICATION.md#step-3-2).
- [ ] **3.3 Qualification / консультация** — см. [ТЗ шага 3.3](REMAINING-SPECIFICATION.md#step-3-3).
- [ ] **3.4 Thinking / unavailable / lost** — см. [ТЗ шага 3.4](REMAINING-SPECIFICATION.md#step-3-4).

### Phase 4 — medical, media и подписанные документы (§4,36–39,72)

- [ ] **4.1 Медицинское решение** — см. [ТЗ шага 4.1](REMAINING-SPECIFICATION.md#step-4-1).
- [ ] **4.2 Media model / secure upload** — см. [ТЗ шага 4.2](REMAINING-SPECIFICATION.md#step-4-2).
- [ ] **4.3 Фото по стадиям** — см. [ТЗ шага 4.3](REMAINING-SPECIFICATION.md#step-4-3).
- [ ] **4.4 Подпись и PDF** — см. [ТЗ шага 4.4](REMAINING-SPECIFICATION.md#step-4-4).
- [ ] **4.5 Consent review** — см. [ТЗ шага 4.5](REMAINING-SPECIFICATION.md#step-4-5).

### Phase 5 — календарь, записи и удержание слота (§13–23,51–52)

- [ ] **5.1 Availability** — см. [ТЗ шага 5.1](REMAINING-SPECIFICATION.md#step-5-1).
- [ ] **5.2 Atomic booking** — см. [ТЗ шага 5.2](REMAINING-SPECIFICATION.md#step-5-2).
- [ ] **5.3 Lifecycle / UI** — см. [ТЗ шага 5.3](REMAINING-SPECIFICATION.md#step-5-3).
- [ ] **5.4 Completion / lateness** — см. [ТЗ шага 5.4](REMAINING-SPECIFICATION.md#step-5-4).
- [ ] **5.5 Soft hold** — см. [ТЗ шага 5.5](REMAINING-SPECIFICATION.md#step-5-5).

### Phase 6 — ledger, credit и отчёт (§23–30)

- [ ] **6.1 Ledger / split** — см. [ТЗ шага 6.1](REMAINING-SPECIFICATION.md#step-6-1).
- [ ] **6.2 Credit / acconto** — см. [ТЗ шага 6.2](REMAINING-SPECIFICATION.md#step-6-2).
- [ ] **6.3 Correction / refund** — см. [ТЗ шага 6.3](REMAINING-SPECIFICATION.md#step-6-3).
- [ ] **6.4 Payment check / daily report** — см. [ТЗ шага 6.4](REMAINING-SPECIFICATION.md#step-6-4).

### Phase 7 — PMU, контроль и correction (§31–35)

- [ ] **7.1 Session 1/2** — см. [ТЗ шага 7.1](REMAINING-SPECIFICATION.md#step-7-1).
- [ ] **7.2 Paid correction >60 дней** — см. [ТЗ шага 7.2](REMAINING-SPECIFICATION.md#step-7-2).
- [ ] **7.3 Control outcomes / free correction** — см. [ТЗ шага 7.3](REMAINING-SPECIFICATION.md#step-7-3).

### Phase 8 — Total Face и Remover (§11–12,45)

- [ ] **8.1 Total Face creation** — см. [ТЗ шага 8.1](REMAINING-SPECIFICATION.md#step-8-1).
- [ ] **8.2 Package deadlines / withdrawal** — см. [ТЗ шага 8.2](REMAINING-SPECIFICATION.md#step-8-2).
- [ ] **8.3 Remover sessions** — см. [ТЗ шага 8.3](REMAINING-SPECIFICATION.md#step-8-3).
- [ ] **8.4 Remover review** — см. [ТЗ шага 8.4](REMAINING-SPECIFICATION.md#step-8-4).

### Phase 9 — Conversations и transport (§38,48,56–57)

- [ ] **9.1 Conversation/inbox** — см. [ТЗ шага 9.1](REMAINING-SPECIFICATION.md#step-9-1).
- [ ] **9.2 WhatsApp adapter / media** — см. [ТЗ шага 9.2](REMAINING-SPECIFICATION.md#step-9-2).
- [ ] **9.3 Прочие источники** — см. [ТЗ шага 9.3](REMAINING-SPECIFICATION.md#step-9-3).
- [ ] **9.4 Templates** — см. [ТЗ шага 9.4](REMAINING-SPECIFICATION.md#step-9-4).

### Phase 10 — автоматизации и refresh (§21,36,44,47,58–63)

- [ ] **10.1 Confirmation / pre-care** — см. [ТЗ шага 10.1](REMAINING-SPECIFICATION.md#step-10-1).
- [ ] **10.2 Post-care / check-in** — см. [ТЗ шага 10.2](REMAINING-SPECIFICATION.md#step-10-2).
- [ ] **10.3 Healed photo / attention** — см. [ТЗ шага 10.3](REMAINING-SPECIFICATION.md#step-10-3).
- [ ] **10.4 Google review flow** — см. [ТЗ шага 10.4](REMAINING-SPECIFICATION.md#step-10-4).
- [ ] **10.5 Refresh cycle / follow-ups** — см. [ТЗ шага 10.5](REMAINING-SPECIFICATION.md#step-10-5).

### Phase 11 — AI Agent (§48–55,80)

- [ ] **11.1 Runtime/provider/orchestrator** — см. [ТЗ шага 11.1](REMAINING-SPECIFICATION.md#step-11-1).
- [ ] **11.2 Context Builder** — см. [ТЗ шага 11.2](REMAINING-SPECIFICATION.md#step-11-2).
- [ ] **11.3 Tool Registry** — см. [ТЗ шага 11.3](REMAINING-SPECIFICATION.md#step-11-3).
- [ ] **11.4 Policy Engine** — см. [ТЗ шага 11.4](REMAINING-SPECIFICATION.md#step-11-4).
- [ ] **11.5 Knowledge Base + RAG** — см. [ТЗ шага 11.5](REMAINING-SPECIFICATION.md#step-11-5).
- [ ] **11.6 Memory/summaries** — см. [ТЗ шага 11.6](REMAINING-SPECIFICATION.md#step-11-6).
- [ ] **11.7 Takeover/Assist/Return** — см. [ТЗ шага 11.7](REMAINING-SPECIFICATION.md#step-11-7).
- [ ] **11.8 Escalation/complaints** — см. [ТЗ шага 11.8](REMAINING-SPECIFICATION.md#step-11-8).
- [ ] **11.9 Observability/versioning** — см. [ТЗ шага 11.9](REMAINING-SPECIFICATION.md#step-11-9).
- [ ] **11.10 Evaluation Dataset/release gate** — см. [ТЗ шага 11.10](REMAINING-SPECIFICATION.md#step-11-10).

### Phase 12 — Google Calendar two-way (§15)

- [ ] **12.1 OAuth / outbound** — см. [ТЗ шага 12.1](REMAINING-SPECIFICATION.md#step-12-1).
- [ ] **12.2 Inbound / private busy** — см. [ТЗ шага 12.2](REMAINING-SPECIFICATION.md#step-12-2).

### Phase 13 — ежедневная работа, mobile и timeline (§64–66)

- [ ] **13.1 Today / Week** — см. [ТЗ шага 13.1](REMAINING-SPECIFICATION.md#step-13-1).
- [ ] **13.2 Needs Attention** — см. [ТЗ шага 13.2](REMAINING-SPECIFICATION.md#step-13-2).
- [ ] **13.3 Unified timeline / mobile P0** — см. [ТЗ шага 13.3](REMAINING-SPECIFICATION.md#step-13-3).

### Phase 14 — защита данных и эксплуатация (§68,71–73)

- [ ] **14.1 Export** — см. [ТЗ шага 14.1](REMAINING-SPECIFICATION.md#step-14-1).
- [ ] **14.2 Retention / anonymisation** — см. [ТЗ шага 14.2](REMAINING-SPECIFICATION.md#step-14-2).
- [ ] **14.3 Backups / storage / monitoring** — см. [ТЗ шага 14.3](REMAINING-SPECIFICATION.md#step-14-3).

### Phase 15 — acceptance и выпуск (§74,76–80)

- [ ] **15.1 Technical suite** — см. [ТЗ шага 15.1](REMAINING-SPECIFICATION.md#step-15-1).
- [ ] **15.2 Main E2E** — см. [ТЗ шага 15.2](REMAINING-SPECIFICATION.md#step-15-2).
- [ ] **15.3 Package / Remover E2E** — см. [ТЗ шага 15.3](REMAINING-SPECIFICATION.md#step-15-3).
- [ ] **15.4 Release rehearsal** — см. [ТЗ шага 15.4](REMAINING-SPECIFICATION.md#step-15-4).

### Phase 16 — P2 после рабочего запуска (§75)

- [ ] **16.1 Waitlist** — см. [ТЗ шага 16.1](REMAINING-SPECIFICATION.md#step-16-1).
- [ ] **16.2 Дополнительные пакеты** — см. [ТЗ шага 16.2](REMAINING-SPECIFICATION.md#step-16-2).
- [ ] **16.3 Payment integration** — см. [ТЗ шага 16.3](REMAINING-SPECIFICATION.md#step-16-3).
- [ ] **16.4 Advanced reports** — см. [ТЗ шага 16.4](REMAINING-SPECIFICATION.md#step-16-4).
- [ ] **16.5 Content / automation extension** — см. [ТЗ шага 16.5](REMAINING-SPECIFICATION.md#step-16-5).

## Все 80 разделов Master Specification

Ниже нет автоматического зачёта раздела по наличию enum или SQL-таблицы. PARTIAL означает конкретно указанный остаток. Полные доказательства и пути — в [актуальной матрице](COVERAGE.md).

| § | Требование | Текущее состояние | Что осталось | ROADMAP |
|---|---|---|---|---|
| 1 | ЦЕЛЬ ЭТАПА | NOT ACCEPTED | Единый путь Lead → Refresh отсутствует | 3–15 |
| 2 | ОСНОВНЫЕ ПРИНЦИПЫ АРХИТЕКТУРЫ | PARTIAL | Framework работает; бизнес-события будущих модулей, реальные adapters и общий E2E ещё не подключены | 3–12,15 |
| 3 | ОСНОВНЫЕ СУЩНОСТИ | PARTIAL | Нет полноценной модели cycles/packages/conversations/ledger allocations; schema сама по себе не workflow | 3.1,6.1,8,9.1 |
| 4 | КАРТОЧКА КЛИЕНТА | PARTIAL | Полная medical/clearance модель — Phase 4; consultation slot — Calendar Phase 5; AI tools — Phase 11 | 2.3,4.1,5.1,11.3 |
| 5 | CLIENT DEDUPLICATION | PARTIAL (текущая схема реализована) | Будущие cycles/packages/conversations/ledger расширяют merge registry; поиск имён ограничен; update предлагает ручную проверку | 3,6,7,9,15.1 |
| 6 | СПРАВОЧНИК УСЛУГ | PARTIAL | Legacy требует ручного разбора; Calendar Engine подключается в Phase 5 | 2.1,5.1 |
| 7 | МОДЕЛЬ КОЛИЧЕСТВА СЕССИЙ | PARTIAL | Session workflow ещё не реализован | 2.1,7.1 |
| 8 | ЦЕНЫ И УСЛУГИ | PARTIAL | Требуется отдельный rollout; legacy не переписываются автоматически | 2.1,2.2 |
| 9 | MASTER-SPECIFIC PRICING | PARTIAL | Effective price реализован; будущий booking должен использовать общий resolver | 2.2,5.1 |
| 10 | CUSTOM OFFER | PARTIAL | Client-level offer реализован; ссылки cycle/ledger подключаются в своих фазах | 2.2,3.1,6.1 |
| 11 | TOTAL FACE | MISSING | Нет3 cycles,1400,500/400/500,deadline/extension | 8.1,8.2 |
| 12 | REMOVER | MISSING | Нет variable sessions,100/visit,review30–45,outcomes | 8.3,8.4 |
| 13 | КАЛЕНДАРЬ | FOUNDATION | Нет slot engine/DST/holiday/vacation/override | 5.1 |
| 14 | ПРЕДПОЧТИТЕЛЬНЫЕ СЛОТЫ | MISSING | Нет preferred PMU/consultation slots | 5.1 |
| 15 | GOOGLE CALENDAR | MISSING | Нет two-way sync/private Busy/conflict protocol | 12.1,12.2 |
| 16 | ЗАЩИТА ОТ DOUBLE BOOKING | MISSING | Нет server locking/occupancy exclusion | 5.2 |
| 17 | PREFERRED / ASSIGNED MASTER | PARTIAL | Назначение и история работают; использование при поиске слотов и AI booking ещё не реализовано | 5.1,11.2–11.4 |
| 18 | СТАТУС APPOINTMENT | FOUNDATION/CONFLICT | Нет требуемого lifecycle/actions; один serviceId | 5.3 |
| 19 | AUTOMATIC COMPLETION | MISSING | Реализовать scheduled completion, исключения и human correction с причиной | 5.4 |
| 20 | ОПОЗДАНИЕ | MISSING | Late не обрабатывается | 5.4,11.8 |
| 21 | CONFIRMATION | MISSING | Нет24h/morning/confirmation_missing; silence rule | 10.1 |
| 22 | SOFT HOLD И ACONTO | MISSING | Нет awaiting acconto/2h/8h; слот нельзя auto-release | 5.5 |
| 23 | ACONTO | FOUNDATION | Нет deposit policy и сохранения credit при no-show/cancel | 6.2 |
| 24 | ПЛАТЕЖИ | FOUNDATION | Нет currency/stage/cycle/credit model и posting; баланс не вычисляется сервисом | 6.1,6.2,6.3 |
| 25 | ПРИМЕР PMU PAYMENT FLOW | MISSING | Нет flexible first/second/split payment flow | 6.1,7.1 |
| 26 | PAYMENT CHECK | MISSING | Нет вопроса и missing payment attention | 6.4 |
| 27 | REFUND | PARTIAL | Права ограничены; сам refund, частичный возврат и ledger reconciliation ещё не реализованы | 6.3 |
| 28 | CLIENT CREDIT | MISSING | Нет переносимого client credit | 6.2 |
| 29 | DAILY PAYMENT REPORT | MISSING | Нет дневного отчёта по методам/остаткам/missing/acconto | 6.4 |
| 30 | RECEIPT / INVOICE | MATCH | Официальные документы не генерируются — ограничение сейчас соблюдено | 6.4 |
| 31 | ПЕРВАЯ И ВТОРАЯ PMU ПРОЦЕДУРА | FOUNDATION | Нет cycle clock и правила включённой второй ≤60 дней | 7.1 |
| 32 | ПОСЛЕ 60 ДНЕЙ | MISSING | Нет Owner price/duration/comment/original relation | 7.2 |
| 33 | КОНТРОЛЬ ПОСЛЕ ВТОРОЙ ПРОЦЕДУРЫ | MISSING | Нет планирования30d/30min | 7.3 |
| 34 | РЕЗУЛЬТАТ КОНТРОЛЯ | MISSING | Нет completed/free/paid decision | 7.3 |
| 35 | FREE THIRD CORRECTION | MISSING | Нет free third и45-day guideline | 7.3 |
| 36 | ФОТО ПЕРЕД КОНТРОЛЕМ | MISSING | Нет запроса за3дня и missing task без отмены | 4.2,10.3 |
| 37 | ФОТОГРАФИИ | PARTIAL | Нет требуемых stage guards/healed_result/pre-consult rules | 4.2,4.3 |
| 38 | WHATSAPP MEDIA | MISSING | Нет inbound images и human verification классификации | 9.2,4.2 |
| 39 | CONSENT | PARTIAL/CONFLICT | Нет multi-zone signature/PDF/versions/review2y и restore UI; hard delete заменён архивированием | 4.4,4.5 |
| 40 | ВОРОНКА PMU | CONFLICT | Нет21-stage per-zone pipeline; stages человека не цикл | 3.1,3.2 |
| 41 | КВАЛИФИКАЦИЯ | PARTIAL | Нет формализованного консультационного решения и правила returning client | 3.3 |
| 42 | СУЩЕСТВУЮЩИЙ КЛИЕНТ | MISSING | Нет same-zone≤2yr shortcut и исключений | 3.3 |
| 43 | РЕЗУЛЬТАТ КОНСУЛЬТАЦИИ | MISSING | Нет5 результатов решения мастера | 3.3 |
| 44 | CLIENT THINKING | MISSING | Нет thinking7d и offer validity handling | 3.4 |
| 45 | REMOVAL REQUIRED | MISSING | Remover не связан с сохранённым PMU | 3.1,8.3 |
| 46 | TEMPORARILY UNAVAILABLE | MISSING | Нет reason/reassessment/comment мастера | 3.4 |
| 47 | REFRESH | MISSING | Нет350,last same-zone PMU,year offer,monthly6 stop | 10.5 |
| 48 | AI AGENT — ОСНОВНЫЕ ПРАВИЛА | MISSING | AI runtime/orchestrator/context builder/registry/KB-RAG/memory/execution trace отсутствуют | 11.1,11.2,11.3,11.5,11.6,11.9,11.10 |
| 49 | AI НЕ МОЖЕТ | PARTIAL (запрет generic actions) | Нет работающего AI runtime, зарегистрированных tools, server output policy и adversarial acceptance | 11.3,11.4,11.10 |
| 50 | ВОПРОС О ЦЕНЕ | MISSING | Нет adversarial price policy: примерно/диапазон/старый платёж/слова мастера не должны подтверждать цену | 11.4,11.10 |
| 51 | AI И APPOINTMENTS | MISSING | Нет AI booking через тот же atomic command Phase5; slot recheck и final transaction guard обязательны | 5.2,5.3,11.3 |
| 52 | НЕСТАНДАРТНОЕ ВРЕМЯ | MISSING | Нет exception_requested + handoff; AI не открывает нестандартное время | 5.1,11.4,11.8 |
| 53 | HUMAN TAKEOVER | MISSING | Нет modes и проверки непосредственно перед outbound; pending/stale queues не контролируются | 11.7 |
| 54 | ESCALATION | MISSING | Нет escalation handler по всем причинам и eval coverage | 11.8,11.10 |
| 55 | COMPLAINT | MISSING | Нет atomic complaint takeover+urgent+notify+pause review/send-time guard | 11.8,10.4 |
| 56 | CHANNELS | FOUNDATION | Нет channel adapters; Google leads только при подключении | 9.1,9.2,9.3 |
| 57 | MESSAGE DELIVERY STATUS | MISSING | Нет queued/sent/delivered/read/failed и failed attention | 9.1 |
| 58 | POST-CARE | MISSING | Нет immediate per-zone после session1/2 | 10.2 |
| 59 | CHECK-IN ЧЕРЕЗ 3 ДНЯ | MISSING | Нет day3/no_response без repeat | 10.2 |
| 60 | REVIEW REQUEST | FOUNDATION | Нет one/two-session request timing и complaint pause | 10.4 |
| 61 | GOOGLE REVIEW LINK | MISSING | Нет Google review URL в настройках | 10.4 |
| 62 | REVIEW STATUS | CONFLICT | Это публикация отзыва, не requested/completed/declined/do_not_remind | 10.4 |
| 63 | PRE-CARE | MISSING | Нет планирования и доставки lips -7/-3 дня, обработки переноса и поздней записи | 10.1 |
| 64 | DASHBOARD | CONFLICT | Нет today/week, financial rows,13 attention categories | 13.1,13.2 |
| 65 | MOBILE FIRST | PARTIAL | Полный набор P0 действий, calendar/payment/takeover и проверка 360/390/430px ещё не завершены | 5,6,11.7,13.3 |
| 66 | CLIENT TIMELINE | PARTIAL | Нет общей paginated истории messages/payments/appointments/stages/docs/media | 13.3 |
| 67 | РОЛИ | PARTIAL (текущие роли реализованы) | Матрицу нужно применять к каждому новому domain command и AI tool | 3–12,15.1 |
| 68 | OWNER | PARTIAL | Полноценный export и все будущие бизнес-операции ещё отсутствуют | 14.1,3–12 |
| 69 | ADMIN | PARTIAL (текущие ограничения реализованы) | Будущие calendar/payment/AI workflows требуют реализации и проверок матрицы | 5,6,11,15.1 |
| 70 | MASTER | PARTIAL (текущий scope реализован) | Новые cycles/booking/ledger commands должны сохранить этот scope; полный Master E2E отсутствует | 3–7,15 |
| 71 | AUDIT LOG | PARTIAL (текущие boundaries реализованы) | Расширить event contracts на новые модули; retention/экспорт и эксплуатационная защита журналов отдельно | 3–12,14,15 |
| 72 | DATA PROTECTION | PARTIAL | Нет полного private delivery, retention/anonymisation/export и доказанного backup restore | 4.2,14.1–14.3 |
| 73 | АРХИВИРОВАНИЕ | PARTIAL | Нет полного retention/restore/document version workflow; privacy policy не утверждена | 4.2,4.4,14.2 |
| 74 | P0 — КРИТИЧЕСКИЙ ОБЪЁМ PHASE 3 | MISSING | Ни один P0 пакет целиком не принят E2E | 15.4 |
| 75 | P2 | DEFERRED | Отложено по ТЗ; daily report/export остаются P0 | 16.1,16.2,16.3,16.4,16.5 |
| 76 | ОБЯЗАТЕЛЬНЫЕ TECHNICAL TESTS | PARTIAL (итоговая приёмка открыта) | Все 50 technical acceptance scenarios должны быть привязаны к исполняемым тестам и проверены на готовой системе | 15.1,11.10 |
| 77 | END-TO-END ACCEPTANCE TEST | MISSING (сквозной сценарий) | Human 33-step PMU и AI77.34–48; равенство конечного business state не доказано | 15.2,11.10 |
| 78 | ОТДЕЛЬНЫЙ END-TO-END TEST TOTAL FACE | MISSING | Total Face business E2E и AI13–15:3 зоны/withdrawal/manual reprice/independent deadlines отсутствуют | 15.3,11.10 |
| 79 | ОТДЕЛЬНЫЙ END-TO-END TEST REMOVER | MISSING | Remover business и AI10–12:human decision и original PMU restoration отсутствуют | 15.3,11.10 |
| 80 | КРИТЕРИЙ ГОТОВНОСТИ | NOT ACCEPTED | Нет итоговой приёмки всех P0, реальных integrations/restore/release rehearsal; сборка не равна готовности всей CRM | 15.1–15.4,11.10 |

## Итоговая приёмка и ближайшее действие

[Реестр §§76–79](ACCEPTANCE.md) содержит **125 требований**: 50 technical, 48 main/AI E2E, 15 Total Face, 12 Remover. Это не количество существующих тестов. Отдельные integrity/RBAC/retry/merge случаи уже покрыты, но весь реестр не закрыт как релизная приёмка; текущие 150+4+13 тестов не подменяют эти 125 требований.

Следующий шаг разработки: **3.1 — схема Treatment Cycles**, затем 3.2–3.4. Merge PR, миграции Neon и rollout идут отдельным контролируемым процессом, описанным в оставшемся ТЗ. Их выполнение данным отчётом не разрешается и не заявляется.
