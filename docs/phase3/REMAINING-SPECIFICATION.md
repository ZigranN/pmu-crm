# ТЗ на невыполненный объём PMU CRM Phase 3

Дата: 13.09.2026. База реализации: `eceed9c` (шаги 0.1–2.5). Этот документ выделяет остаток рабочего [Master Specification 1.1](MASTER-SPECIFICATION.md) и [ROADMAP](ROADMAP.md); не отменяет их бизнес-правила. В конфликте сверяться с Master Specification, а неоднозначность фиксировать до зависимой реализации.

## 1. Цель и границы

Довести систему до проверяемого пути Lead → Consultation → Master decision → Treatment Cycle → Acconto → Session 1 → Payment → Post-care → Check-in → Session 2 → Control → Completed → Refresh, с отдельным AI-operated вариантом, Total Face и Remover. Сохранить уже реализованные данные, права, историю, snapshots и поведение.

Не начинать заново auth, клиенты, роли, audit, каталог, prices/offers, dedup или merge. Расширять существующие модули. Оставшийся объём включает Phase 3–15; Phase 16 — отдельно от P0. Наличие legacy таблицы не снимает требования реализовать бизнес-сервис, интерфейс и тесты.

## 2. Общие обязательные требования к каждому шагу

1. **Модель и миграции:** новая миграция, snapshot/relations, проверка fresh/upgrade/repeat. Не переписывать применённые SQL. Сохранить IDs и исходные значения. Автоматический перенос неоднозначных legacy записей запрещён: нужен отчёт для ручного разбора.
2. **Команды:** UI, AI tools, automation и integration используют один domain command. Модель не получает SQL или универсальный DB update. State transitions имеют allowed-from/version/business guards.
3. **Права:** studio/actor определяются сервером; role ceiling, overrides и current Master scope проверяются после lock. Отдельные ограничения финансов/medical/assignment не обходятся integration actor.
4. **Надёжность:** request key + payload fingerprint + replay contract; событие и audit атомарны с DB effect. Внешний эффект идёт через outbox. Неопределённый результат provider send сначала reconcile, а не blind retry.
5. **История:** actor/time/entity/before/after/reason; audit failure откатывает критичную мутацию. Чувствительное чтение проходит access logging, данные не выдаются при его ошибке.
6. **Объединение клиентов:** каждый новый client FK добавляется в merge-registry, provenance и rich fixture. Косвенные связи, JSON/external references и aliases проходят отдельную проверку. Новые UI/reads разрешают старые IDs и проверяют scope конечного клиента; старые mutation forms не должны портить объединённую карточку.
7. **Время:** Europe/Rome для бизнес-дат и локальных правил, UTC instants для выполнения; DST gap/fold, переносы и смена версии расписания должны быть проверены.
8. **Деньги:** integer cents, currency, source operation и immutable correction/reversal. Не брать cache LTV или ручной balance за источник финансовой истины. Credit transfer не создаёт новое поступление.
9. **Интерфейс:** сохранять ввод при ошибке, блокировать конкурентную отправку формы, показывать понятный итог/конфликт; мобильный happy/error path и доступные подписи контролов. Не показывать неподключённый канал работающим.
10. **Приёмка:** Trigger → Conditions → Action → Error handling → Audit → User-visible result. После существенной правки typecheck/lint/build и релевантные тесты; перед завершением шага полный CI и затронутый E2E. Все проверки — на изолированной БД, без реальных клиентов.

Имена новых файлов ниже — предлагаемые точки реализации, не утверждение об их существовании. Короткие имена файлов относятся к указанному в том же шаге feature/server или components; при реализации фиксировать окончательные полные пути в baseline. Для новых schema entities всегда дополнять `src/db/schema.ts`, `src/db/relations.ts`, `drizzle/` и merge registry.

## 3. Подключение уже готового кода к рабочей среде — ещё не подтверждено

- [ ] Проверить актуальные head/base и CI каждого PR №7–12; подготовить итоговый review цепочки. Наличие MERGED у №1–6 не доказывает применение соответствующей SQL-цепочки.
- [ ] До реального rollout определить среду, проверить текущую миграционную историю read-only, выполнить backup и rehearsal на копии. Затем согласовать порядок миграций/версий приложения, остановку несовместимых writes при необходимости и recovery plan.
- [ ] Настроить раздельные development/preview/production URLs, auth callbacks и server secrets; убрать конфликтующие значения конфигурации. Проверить актуальность зависимостей через audit и разобрать findings; старые числа уязвимостей не считать текущим отчётом. Ранее опубликованные в переписке рабочие секреты заменить до публичного запуска, не включать их в документы или Git.
- [ ] Включить worker scheduler только после готовности схемы, секрета и соответствующих handlers; проверить pending/retry/dead-letter/recovery на тестовом контуре.
- [ ] После разрешённого rollout проверить логин, роли, сохранение клиента, audit, каталог, offers/dedup/merge на тестовых данных разрешённой среды и все критичные пути выпуска.

**Приёмка:** зафиксированы commit/deployment/migration versions, воспроизводимый smoke, сохранность данных и восстановление. **Ограничение:** этот документ не выполняет и не разрешает Git merge или миграцию Neon вопреки текущему запрету пользователя.

## 4. Детальное ТЗ по оставшимся шагам


### Phase 3 — treatment cycles и pipeline (§3,40–46)

<a id="step-3-1"></a>

#### 3.1 Схема циклов

**Статус:** foundation реализован в `codex/phase-3-cycle-schema`; см. [baseline](TREATMENT-CYCLE-SCHEMA-BASELINE.md). Историческое задание ниже сохранено как критерий шага. Backfill выполняется только после ручного разбора, commands/workflow — 3.2. **Основание:** §3,40–46.

**Файлы/модули:** `src/db/schema.ts`; `src/db/relations.ts`; +src/features/treatment-cycles/schemas/cycle.schema.ts.

**Требуется реализовать:** Cycle одной зоны; linked prior/remover/correction; package shell; appointment_cycles; snapshots, version; legacy clientStatus остаётся отдельно до backfill.

**Критерий готовности:** Независимые зоны, multi-cycle visit, исторические IDs сохранены.

**Обязательные тесты:** Multi-zone fixture; FK/studio checks; backfill; incompatible legacy record report.

**Зависимости:** Phase 0–2; запись в календарь и финансы подключаются по мере Phase 5–6.

<a id="step-3-2"></a>

#### 3.2 21 стадия

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §3,40–46.

**Файлы/модули:** +src/features/treatment-cycles/server/transitions.ts; +server/actions.ts; +components/cycle-board.tsx; +src/app/(dashboard)/deals/page.tsx.

**Требуется реализовать:** Все стадии §40; allowed transitions/guards; triggers/events; human decisions; timeline цикла.

**Критерий готовности:** Смена стадии работает через command; запрещённый переход ничего не пишет.

**Обязательные тесты:** Transition matrix, replay, stale version, cross-master access.

**Зависимости:** Phase 0–2; запись в календарь и финансы подключаются по мере Phase 5–6.

<a id="step-3-3"></a>

#### 3.3 Qualification / консультация

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §3,40–46.

**Файлы/модули:** +src/features/consultations/server/qualification.ts; +server/results.ts; +components/result-form.tsx.

**Требуется реализовать:** Same-zone ≤2 years допускает без консультации при отсутствии исключений §42; 5 outcomes §43; overdue decision task.

**Критерий готовности:** Returning client не обходит необходимые оценки; removal/thinking/unavailable имеют собственные ветки.

**Обязательные тесты:** 2-year boundary; previous other-master PMU; all five outcomes; decision missing.

**Зависимости:** Phase 0–2; запись в календарь и финансы подключаются по мере Phase 5–6.

<a id="step-3-4"></a>

#### 3.4 Thinking / unavailable / lost

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §3,40–46.

**Файлы/модули:** +src/features/treatment-cycles/server/followups.ts; src/server/events/worker.ts.

**Требуется реализовать:** Thinking +7 дней; условия около недели без самовольного пересчёта; unavailable reason/reassessment/comment от мастера; lost history.

**Критерий готовности:** Нет бесконечных одинаковых задач; reassessment не назначается AI; исходный PMU при removal сохраняется.

**Обязательные тесты:** Fake clock; rescheduled reassessment; reason required; linked remover idempotency.

**Зависимости:** Phase 0–2; запись в календарь и финансы подключаются по мере Phase 5–6.


### Phase 4 — medical, media и подписанные документы (§4,36–39,72)

<a id="step-4-1"></a>

#### 4.1 Медицинское решение

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §4,36–39,72.

**Файлы/модули:** +src/features/medical/server/clearance.ts; `src/features/clients/components/medical-profile-form.tsx`; `src/db/schema.ts`.

**Требуется реализовать:** Clearance Owner/Master, actor/time/reason и medical revision; Admin читает; significant medical change запускает review.

**Критерий готовности:** Решение нельзя подменить редактированием анкеты или AI tool.

**Обязательные тесты:** Role denial; stale revision; review_required after change; audit rollback.

**Зависимости:** Клиенты/RBAC/audit и схема циклов Phase 3; provider storage проверяется отдельно.

<a id="step-4-2"></a>

#### 4.2 Media model / secure upload

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §4,36–39,72.

**Файлы/модули:** `src/features/media/server/service.ts`; actions.ts; components/client-media-section.tsx; `src/lib/cloudinary.ts`; `src/app/api/media/upload/route.ts`; `src/db/schema.ts`.

**Требуется реализовать:** Client/zone/cycle/appointment, before/immediately_after/healed_result, source/purpose/unverified/verified; server size/type validation; private delivery; upload compensation.

**Критерий готовности:** Клиентские фото защищены; master подтверждает classification; archive не уничтожает документный оригинал.

**Обязательные тесты:** Upload failure; wrong tenant/master; MIME/size; orphan cleanup; signed URL/access.

**Зависимости:** Клиенты/RBAC/audit и схема циклов Phase 3; provider storage проверяется отдельно.

<a id="step-4-3"></a>

#### 4.3 Фото по стадиям

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §4,36–39,72.

**Файлы/модули:** +src/features/media/server/requirements.ts; +components/photo-review.tsx; cycle/consultation forms.

**Требуется реализовать:** До консультации lips/eyes обязательно, brows рекомендовано; PMU before/after/healed на соответствующем этапе; Remover after каждый раз.

**Критерий готовности:** Не требуется healed до первой процедуры; отсутствие фото перед контролем не отменяет запись.

**Обязательные тесты:** Stage-specific validation; recommended vs required; no-photo keeps control active.

**Зависимости:** Клиенты/RBAC/audit и схема циклов Phase 3; provider storage проверяется отдельно.

<a id="step-4-4"></a>

#### 4.4 Подпись и PDF

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §4,36–39,72.

**Файлы/модули:** `src/features/consent/server/service.ts`; actions.ts; +components/signature-pad.tsx; +components/client-consents.tsx; +server/pdf.ts; `src/db/schema.ts`; clients/[id]/page.tsx.

**Требуется реализовать:** Multi-zone consent coverage, finger signature, подписант/версия/time/status, PDF immutable hash; реальный consent UI вместо media tab.

**Критерий готовности:** Finger-sign создаёт PDF и consent record; старые версии читаемы; нельзя заменить PDF молча.

**Обязательные тесты:** Mobile signature; PDF render verification; multi-zone coverage; re-sign/supersede; failed generation rollback.

**Зависимости:** Клиенты/RBAC/audit и схема циклов Phase 3; provider storage проверяется отдельно.

<a id="step-4-5"></a>

#### 4.5 Consent review

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §4,36–39,72.

**Файлы/модули:** +src/features/consent/server/review.ts; worker; medical actions.

**Требуется реализовать:** valid/review_required/superseded; каждые 2 года; document/medical changes; Confirm still valid с историей, новая подпись при необходимости.

**Критерий готовности:** Старый signed_at не переписывается; review и renewed validity имеют след.

**Обязательные тесты:** Two-year boundary; still valid; new version; changed answers; repeat job.

**Зависимости:** Клиенты/RBAC/audit и схема циклов Phase 3; provider storage проверяется отдельно.


### Phase 5 — календарь, записи и удержание слота (§13–23,51–52)

<a id="step-5-1"></a>

#### 5.1 Availability

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §13–23,51–52.

**Файлы/модули:** +src/features/calendar/server/availability.ts; +holidays.ts; `src/db/schema.ts`; `src/app/(dashboard)/masters/[id]/schedule/page.tsx`.

**Требуется реализовать:** Europe/Rome rules + UTC instants; weekdays, lunch, Italian holidays, vacations, explicit dated overrides; preferred slots и 30/60/120 min.

**Критерий готовности:** CET/CEST корректны; AI не открывает часы; buffer не увеличивает время.

**Обязательные тесты:** DST gaps/folds; lunch crossing; holidays/vacation/override; adjacent slots.

**Зависимости:** Каталог/pricing/masters и циклы; использовать worker 1.4; acconto требует согласованного ledger-контракта 6.2.

<a id="step-5-2"></a>

#### 5.2 Atomic booking

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §13–23,51–52.

**Файлы/модули:** +src/features/appointments/server/booking.ts; `src/db/schema.ts`; новая occupancy/locking migration.

**Требуется реализовать:** Общий ресурс времени для confirmed/awaiting acconto и busy; transactional overlap guard; multi-cycle visit.

**Критерий готовности:** Из двух одновременных overlapping bookings подтверждается один; отмена/перенос используют тот же протокол.

**Обязательные тесты:** Real Postgres concurrent exact/partial overlap; block-vs-booking; idempotency; distinct masters.

**Зависимости:** Каталог/pricing/masters и циклы; использовать worker 1.4; acconto требует согласованного ledger-контракта 6.2.

<a id="step-5-3"></a>

#### 5.3 Lifecycle / UI

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §13–23,51–52.

**Файлы/модули:** +src/features/appointments/server/lifecycle.ts; +actions.ts; +components/appointment-form.tsx; +src/app/(dashboard)/calendar/page.tsx; +appointments/[id]/page.tsx.

**Требуется реализовать:** §18 статусы плюс ожидание acconto; reschedule old/new/history/count, cancel reason, no physical delete; client/master/time snapshots.

**Критерий готовности:** Нет потери истории и credit; нет жёсткого лимита переносов; stale jobs инвалидируются.

**Обязательные тесты:** Create/edit/reschedule/cancel/no-show; wrong role; failed move retains prior reservation.

**Зависимости:** Каталог/pricing/masters и циклы; использовать worker 1.4; acconto требует согласованного ledger-контракта 6.2.

<a id="step-5-4"></a>

#### 5.4 Completion / lateness

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §13–23,51–52.

**Файлы/модули:** +src/features/appointments/server/completion.ts; worker.

**Требуется реализовать:** Auto-completed после end с исключениями; human correction reason/user/time; attendance отдельно от clinical outcome; late alert без переноса.

**Критерий готовности:** Job не завершает отменённое; исправление не дублирует процедуру/платёж.

**Обязательные тесты:** Fake clock; reschedule race; no-show; corrected completed; lateness.

**Зависимости:** Каталог/pricing/masters и циклы; использовать worker 1.4; acconto требует согласованного ledger-контракта 6.2.

<a id="step-5-5"></a>

#### 5.5 Soft hold

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §13–23,51–52.

**Файлы/модули:** +src/features/appointments/server/holds.ts; worker; attention service.

**Требуется реализовать:** Awaiting acconto занимает слот; +2h красный alert, +8h второе предупреждение; ручное решение Master/Admin/Owner.

**Критерий готовности:** **Никогда не освобождает слот автоматически**; оплата закрывает alerts; repeat jobs безопасны.

**Обязательные тесты:** 2h/8h boundary, replay, deposit-vs-alert, manual release authority, hold collision.

**Зависимости:** Каталог/pricing/masters и циклы; использовать worker 1.4; acconto требует согласованного ledger-контракта 6.2.


### Phase 6 — ledger, credit и отчёт (§23–30)

<a id="step-6-1"></a>

#### 6.1 Ledger / split

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §23–30.

**Файлы/модули:** +src/features/payments/server/ledger.ts; +actions.ts; +components/client-ledger.tsx; `src/db/schema.ts`.

**Требуется реализовать:** Amount/currency/method/time/stage/entered_by/note; confirmed payments; split entries; agreed price snapshot; immutable posting/reversal.

**Критерий готовности:** Баланс вычисляется, не вводится; card+cash отдельны; partial/full allowed, пример €300 не hard rule.

**Обязательные тесты:** €550: deposit50+card200+cash100 → balance200; full/partial; duplicate posting; cents.

**Зависимости:** Циклы, prices/offers и appointment contract; рабочий путь 5.5/6.2 принимается совместно.

<a id="step-6-2"></a>

#### 6.2 Credit / acconto

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §23–30.

**Файлы/модули:** +src/features/payments/server/credits.ts; ledger; holds; `src/db/schema.ts`.

**Требуется реализовать:** PMU/Total Face €50; no deposit Remover/Laminazione/Skin; cancel/no-show/reschedule сохраняют credit; allocate future cycle без double count.

**Критерий готовности:** Один €50 учитывается один раз, перенос credit не новое поступление; unapplied credit сохраняется.

**Обязательные тесты:** Cancel/no-show after deposit; reallocate future cycle; concurrent allocation; overpayment accounting.

**Зависимости:** Циклы, prices/offers и appointment contract; рабочий путь 5.5/6.2 принимается совместно.

<a id="step-6-3"></a>

#### 6.3 Correction / refund

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §23–30.

**Файлы/модули:** +src/features/payments/server/corrections.ts; +refunds.ts; +components/payment-correction.tsx.

**Требуется реализовать:** Correction отдельная операция, не overwrite; refund только Owner; связать оригинал, amount/reason/actor; audit.

**Критерий готовности:** Admin/Master/AI refund запрещён; остаток сверяем; исправление отличается от paid treatment correction.

**Обязательные тесты:** Partial/full refund; denied roles; duplicate refund; reversal; original immutable.

**Зависимости:** Циклы, prices/offers и appointment contract; рабочий путь 5.5/6.2 принимается совместно.

<a id="step-6-4"></a>

#### 6.4 Payment check / daily report

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §23–30.

**Файлы/модули:** +src/features/payments/server/checks.ts; +reports.ts; +components/payment-check.tsx; +src/app/(dashboard)/payments/page.tsx.

**Требуется реализовать:** После процедуры спросить received/amount/method/comment; missing task; Rome-day totals cash/card/transfer/other, received, balance, missing, pending acconto.

**Критерий готовности:** Необозначенная/неполная оплата не выдумывается; нет жёсткого запрета процедуры из-за остатка; **без официальной fattura/ricevuta**.

**Обязательные тесты:** Midnight/DST daily totals; refunds/credits не double count; master scope; missed payment.

**Зависимости:** Циклы, prices/offers и appointment contract; рабочий путь 5.5/6.2 принимается совместно.


### Phase 7 — PMU, контроль и correction (§31–35)

<a id="step-7-1"></a>

#### 7.1 Session 1/2

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §31–35.

**Файлы/модули:** +src/features/procedures/server/session.ts; +components/session-form.tsx; cycle transitions; ledger checks.

**Требуется реализовать:** One/two models, clinical completion, фото и clearance/document state; second session ≤60 дней от первой своей зоны входит в agreed price.

**Критерий готовности:** Первая/вторая другой зоны не меняет clock; payment prompt вместо произвольного запрета при partial pay.

**Обязательные тесты:** 60-day boundary; two zones; fully paid at session1; one-session cycle; duplicate completion.

**Зависимости:** Циклы, medical/media/documents, booking и ledger (Phase 3–6).

<a id="step-7-2"></a>

#### 7.2 Paid correction >60 дней

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §31–35.

**Файлы/модули:** +src/features/corrections/server/paid.ts; +components/paid-correction-form.tsx; `src/db/schema.ts`.

**Требуется реализовать:** После 60 дней no automatic price; Owner Create paid correction: price/duration/comment/link original.

**Критерий готовности:** Старый cycle и исходные платежи не заменяются; AI/Admin не назначают эту цену.

**Обязательные тесты:** Day61; Owner-only creation; no automatic charge; linked history.

**Зависимости:** Циклы, medical/media/documents, booking и ledger (Phase 3–6).

<a id="step-7-3"></a>

#### 7.3 Control outcomes / free correction

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §31–35.

**Файлы/модули:** +src/features/controls/server/service.ts; +components/result-form.tsx; +src/features/corrections/server/free.ts.

**Требуется реализовать:** Control ~30 дней после session2, 30 min; completed/free approved/paid; free third only Master, ориентир 45 дней; оплачиваемое решение через authorised pricing path.

**Критерий готовности:** Контроль не считается клинически завершённым только по часам; free third не создаётся автоматически.

**Обязательные тесты:** All outcomes; third approval; 45-day policy anchor; Owner-priced paid branch.

**Зависимости:** Циклы, medical/media/documents, booking и ledger (Phase 3–6).


### Phase 8 — Total Face и Remover (§11–12,45)

<a id="step-8-1"></a>

#### 8.1 Total Face creation

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §11–12,45.

**Файлы/модули:** +src/features/packages/server/total-face.ts; +components/package-card.tsx; `src/db/schema.ts`.

**Требуется реализовать:** Одна tx: package+3 independent cycles; €1400, max techniques, 500/400/500 accounting; package-level payment без мгновенной allocation.

**Критерий готовности:** Ровно три зоны; acconto €50 на пакет; не три deposit; snapshots сохраняются.

**Обязательные тесты:** Creation replay/rollback; breakdown sum; package unallocated receipt.

**Зависимости:** Циклы, booking, ledger, medical/media и PMU rules (Phase 3–7).

<a id="step-8-2"></a>

#### 8.2 Package deadlines / withdrawal

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §11–12,45.

**Файлы/модули:** +src/features/packages/server/deadlines.ts; +actions.ts; worker.

**Требуется реализовать:** Preferred1–2 недели; max30 дней от первой выполненной зоны; deadline event/task; manual reprice/extend/withdraw reason Owner/Admin.

**Критерий готовности:** Просрочка сама не меняет сумму; Session2/refresh clocks независимы.

**Обязательные тесты:** Third-zone delay; day30; extension; refused zone; no auto reprice; separate deadlines.

**Зависимости:** Циклы, booking, ledger, medical/media и PMU rules (Phase 3–7).

<a id="step-8-3"></a>

#### 8.3 Remover sessions

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §11–12,45.

**Файлы/модули:** +src/features/remover/server/sessions.ts; +components/session-form.tsx; media requirements.

**Требуется реализовать:** Brows/lips/eyes, variable visits60min, €100/visit, no deposit, photos each session; original PMU stays linked.

**Критерий готовности:** Любое количество сессий; оплата отдельно за визит; original not lost.

**Обязательные тесты:** Repeat visits; billing; before/after evidence; retained original cycle.

**Зависимости:** Циклы, booking, ledger, medical/media и PMU rules (Phase 3–7).

<a id="step-8-4"></a>

#### 8.4 Remover review

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §11–12,45.

**Файлы/модули:** +src/features/remover/server/review.ts; +components/review-form.tsx; calendar.

**Требуется реализовать:** ~30/max45 дней,30min, in-person/remote photo; Repeat/Ready/Wait/Stop; Repeat offers60min; Ready reactivates original.

**Критерий готовности:** Все 4 outcomes; remote verification; Wait/Stop не удаляют PMU.

**Обязательные тесты:** Four branches; day30/45; remote photo; Ready original restoration.

**Зависимости:** Циклы, booking, ledger, medical/media и PMU rules (Phase 3–7).


### Phase 9 — Conversations и transport (§38,48,56–57)

<a id="step-9-1"></a>

#### 9.1 Conversation/inbox

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §38,48,56–57.

**Файлы/модули:** +src/features/conversations/server/service.ts; +components/inbox.tsx; `src/db/schema.ts`.

**Требуется реализовать:** Channel/external IDs/direction/client linkage; full context; pagination; delivery queued/sent/delivered/read/failed.

**Критерий готовности:** Все сообщения видимы по времени; failed создаёт Needs Attention, не считается успешной инструкцией.

**Обязательные тесты:** Out-of-order delivery; different channels same external ID; pagination; failed task.

**Зависимости:** Client identity/merge, access/audit/outbox, защищённое media; реальные каналы требуют настроенного provider sandbox.

<a id="step-9-2"></a>

#### 9.2 WhatsApp adapter / media

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §38,48,56–57.

**Файлы/модули:** +src/features/conversations/adapters/whatsapp.ts; +src/app/api/webhooks/whatsapp/route.ts; +src/features/media/server/inbound.ts.

**Требуется реализовать:** Verify signature, inbox dedup, provider correlation, send/reconcile, inbound photos source/purpose/zone guess unverified, master verify.

**Критерий готовности:** Повтор webhook не создаёт клиента/сообщение/фото; AI classification не medical verdict.

**Обязательные тесты:** Bad signature; repeated inbound; media download failure; wrong zone correction; send timeout.

**Зависимости:** Client identity/merge, access/audit/outbox, защищённое media; реальные каналы требуют настроенного provider sandbox.

<a id="step-9-3"></a>

#### 9.3 Прочие источники

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §38,48,56–57.

**Файлы/модули:** +src/features/conversations/adapters/instagram.ts; +facebook.ts; +website.ts; +lead-sources.ts; corresponding webhook routes.

**Требуется реализовать:** Единый adapter contract WhatsApp/IG/FB/site; Google-related leads только при подключении источника; status/config per channel.

**Критерий готовности:** Неподключённый канал не показан работающим; подключённый проходит contract test.

**Обязательные тесты:** Source/identity mapping; secrets missing; disabled channel; provider sandbox.

**Зависимости:** Client identity/merge, access/audit/outbox, защищённое media; реальные каналы требуют настроенного provider sandbox.

<a id="step-9-4"></a>

#### 9.4 Templates

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §38,48,56–57.

**Файлы/модули:** +src/features/templates/server/service.ts; +components/template-editor.tsx; `src/db/schema.ts`.

**Требуется реализовать:** Approved/versioned templates per language/zone/purpose; permission; delivery records reference version; pricing content недоступен AI response.

**Критерий готовности:** AI отправляет только утверждённое; review URL подставляется из Settings; бренд lip care необязателен.

**Обязательные тесты:** Unapproved denied; language fallback; version snapshot; no price disclosure.

**Зависимости:** Client identity/merge, access/audit/outbox, защищённое media; реальные каналы требуют настроенного provider sandbox.


### Phase 10 — автоматизации и refresh (§21,36,44,47,58–63)

<a id="step-10-1"></a>

#### 10.1 Confirmation / pre-care

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §21,36,44,47,58–63.

**Файлы/модули:** +src/features/automations/server/appointment-handlers.ts; worker; templates.

**Требуется реализовать:** Booking date/time/address; -24h, morning repeat; Confermo/Devo spostare; confirmation_missing без отмены; lips -7d/-3d.

**Критерий готовности:** Перенос отменяет старые jobs и создаёт новые; позднее бронирование не шлёт просроченные инструкции пачкой.

**Обязательные тесты:** Fake clock; reschedule; no reply keeps slot; close booking policy; send failure.

**Зависимости:** Versioned domain events, templates и transport Phase 9; clock tests возможны до подключения реальных каналов, доставка — нет.

<a id="step-10-2"></a>

#### 10.2 Post-care / check-in

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §21,36,44,47,58–63.

**Файлы/модули:** +src/features/automations/server/postcare.ts; +checkin.ts.

**Требуется реализовать:** Сразу после session1 и 2 по каждой зоне; day3 персональный check-in; no_response без повторного check-in.

**Критерий готовности:** Две зоны → две инструкции; повтор event не шлёт ещё раз; неответ не запускает цепочку.

**Обязательные тесты:** Multi-zone; two sessions; no_response; duplicate event; complaint escalation.

**Зависимости:** Versioned domain events, templates и transport Phase 9; clock tests возможны до подключения реальных каналов, доставка — нет.

<a id="step-10-3"></a>

#### 10.3 Healed photo / attention

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §21,36,44,47,58–63.

**Файлы/модули:** +src/features/automations/server/healed-photos.ts; controls; media.

**Требуется реализовать:** За 3 дня до ~30d control запрос; source/unverified; master verifies; missing task; appointment stays active.

**Критерий готовности:** Missing фото не отменяет control; новые фото разрешают task по актуальному cycle.

**Обязательные тесты:** Rescheduled control; late photo; rejected classification; missing; duplicate webhook.

**Зависимости:** Versioned domain events, templates и transport Phase 9; clock tests возможны до подключения реальных каналов, доставка — нет.

<a id="step-10-4"></a>

#### 10.4 Google review flow

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §21,36,44,47,58–63.

**Файлы/модули:** +src/features/reviews/server/requests.ts; +components/review-status.tsx; `src/features/settings/schemas/studio-settings.schema.ts`; components/studio-settings-form.tsx; `src/db/schema.ts`.

**Требуется реализовать:** After session2; one-session ~30d; complaint pause; requested/completed/declined/do_not_remind; studio Google review URL.

**Критерий готовности:** Не повторять completed/declined/do_not_remind на уровне клиента/студии, включая другой cycle; URL не hardcoded; complaint stops pending send.

**Обязательные тесты:** Duplicate trigger; opt-out; complaint just before send; settings URL change; one/two sessions.

**Зависимости:** Versioned domain events, templates и transport Phase 9; clock tests возможны до подключения реальных каналов, доставка — нет.

<a id="step-10-5"></a>

#### 10.5 Refresh cycle / follow-ups

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §21,36,44,47,58–63.

**Файлы/модули:** +src/features/treatment-cycles/server/refresh.ts; +src/features/automations/server/refresh-followups.ts.

**Требуется реализовать:** Новый linked same-zone cycle €350; last performed PMU anchor; offer after year, no auto booking; monthly максимум 6 attempts, refresh_no_response stop.

**Критерий готовности:** Новая процедура зоны пересчитывает её план; другая зона не затронута; нет седьмой попытки.

**Обязательные тесты:** Fake year/month clocks;6 attempts; reply/decline; reschedule/new procedure; separate zones.

**Зависимости:** Versioned domain events, templates и transport Phase 9; clock tests возможны до подключения реальных каналов, доставка — нет.


### Phase 11 — AI Agent (§48–55,80)

<a id="step-11-1"></a>

#### 11.1 Runtime/provider/orchestrator

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/client.ts; config.ts; orchestrator.ts; src/lib/env.ts.

**Требуется реализовать:** OpenAI API, configured model/timeouts/retry budget, structured output validation; execution state и correlation; API key только на сервере.

**Критерий готовности:** Один entrypoint; bounded tools/iterations/cost; recovery по command result без дублей.

**Обязательные тесты:** Provider timeout before/after tool success; malformed output; rate limit; exhausted budget;76.42–43.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-2"></a>

#### 11.2 Context Builder

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/context-builder.ts; conversation-context.ts; crm-context.ts.

**Требуется реализовать:** Minimal scoped live facts+versions, recent+summary+approved chunks; no DB dump/price leak; mandatory policy survives token limits.

**Критерий готовности:** Live data выше stale memory; current cycle/assignment не теряются; insufficient context → clarify/handoff.

**Обязательные тесты:** Cross-tenant; stale summary; three-zone clocks; late second session; ambiguous time/language;76.35,39,49.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-3"></a>

#### 11.3 Tool Registry

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/tools/registry.ts; client.ts; calendar.ts; appointments.ts; cycles.ts; conversations.ts; handoff.ts.

**Требуется реализовать:** Typed versioned allowlist; server AI actor/scope/key; same domain commands; no SQL/generic update tool; query и mutation разделены.

**Критерий готовности:** Unknown/forbidden tool rejected; UI/AI создают один Appointment contract; no duplicate client/cycle.

**Обязательные тесты:** 76.26–28,33; malicious args; atomic slot race; source search before create; human/AI differential test.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-4"></a>

#### 11.4 Policy Engine

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/policy.ts; response-policy.ts; policies.ts.

**Требуется реализовать:** Server guards+outbound allowlist; no price/range/discount/refund/clearance/medical verdict/free-third/late-session decision/new master/exception slot/delete.

**Критерий готовности:** Blocked answer не отправлен; adversarial input/RAG не расширяет права; safe consultation/handoff.

**Обязательные тесты:** 76.29–34; direct tool injection; quoted old prices; complaints; approved-template-only medical content.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-5"></a>

#### 11.5 Knowledge Base + RAG

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai-knowledge/server/service.ts; retrieval.ts; indexing.ts; components/knowledge-base.tsx; src/app/(dashboard)/ai/knowledge/page.tsx; src/db/schema.ts.

**Требуется реализовать:** Documents/versions/chunks/embeddings; draft/approved/archived, tenant/language ACL; version-aware indexing/cache/retrieval; human approval.

**Критерий готовности:** Только approved+permitted chunks; no answer invention on empty/irrelevant; source/version trace; archived cache invalidated.

**Обязательные тесты:** 76.36–38; malicious chunk; approval revoke before send; empty/reindex failure; no price leakage.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-6"></a>

#### 11.6 Memory/summaries

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/memory.ts; summary-schema.ts; src/features/conversations/server/summaries.ts; src/db/schema.ts.

**Требуется реализовать:** Structured summary intent/zones/previousPmu/openQuestions/promisedActions/currentDecision + provenance; incremental version.

**Критерий готовности:** CRM facts primary; promised≠done; no medical inference; no cross-client memory.

**Обязательные тесты:** 76.39–40; long/multilingual history; new booking invalidates stale summary; summary injection.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-7"></a>

#### 11.7 Takeover/Assist/Return

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/conversations/server/takeover.ts; components/takeover-controls.tsx; outbound worker.

**Требуется реализовать:** Mode version at generate+send; human-only drafts; cancel stale queue; explicit Return; audit.

**Критерий готовности:** No independent outbound in takeover/assist; Return handles new request without replaying stale messages.

**Обязательные тесты:** 76.44–46; race/in-flight send boundary; manual reply; mode version mismatch;77.47–48.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-8"></a>

#### 11.8 Escalation/complaints

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/escalation.ts; src/features/attention/server/service.ts; complaints UI.

**Требуется реализовать:** All§54 reasons; complaint→takeover+urgent task+notify+review pause; exception_requested; dedup.

**Критерий готовности:** Medical/risk/refund/complex previous PMU handed to human; no inferred removal_required.

**Обязательные тесты:** 76.47–48; all reasons; pending-review race;79.10–12.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-9"></a>

#### 11.9 Observability/versioning

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** src/features/ai/server/execution-log.ts; metrics.ts; prompt-registry.ts; src/features/ai/components/execution-detail.tsx; src/db/schema.ts.

**Требуется реализовать:** Provider/model/prompt/policy/knowledge/tools versions; latency/tokens/errors/blocks/handoff/retrieval trace; restricted redacted evidence; Needs Attention.

**Критерий готовности:** Можно проследить source→policy→tool→outbound; no secrets/hidden reasoning; prompt rollback supports pinned versions.

**Обязательные тесты:** 76.41,50; trace completeness; tenant access; redaction/retention; unavailable metrics; provider error.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.

<a id="step-11-10"></a>

#### 11.10 Evaluation Dataset/release gate

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §48–55,80.

**Файлы/модули:** tests/fixtures/ai/*.jsonl; tests/evals/ai-policy.eval.ts; ai-conversations.eval.ts; tests/e2e/ai-client-agent.spec.ts; docs/phase3/AI-EVAL-PLAN.md.

**Требуется реализовать:** 180 human-reviewed scenarios (minimum150, target range150–200), separate from KB; deterministic guards+graded conversation+holdout; versioned repeated runs.

**Критерий готовности:** Critical forbidden actions/disclosures=0 in evaluated runs; all mandatory cases pass; quality thresholds documented; change model/prompt/KB→eval before enable.

**Обязательные тесты:** Late Session2 AI-EVAL-042; 50 technical tests and added AI E2E; tool results+final states not text-only scoring.

**Зависимости:** Phase 3–10 и approved знания; AI/Google E2E завершать после Phase 12.


### Phase 12 — Google Calendar two-way (§15)

<a id="step-12-1"></a>

#### 12.1 OAuth / outbound

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §15.

**Файлы/модули:** +src/features/google-calendar/server/oauth.ts; +sync-out.ts; +components/calendar-connection.tsx; `src/db/schema.ts`.

**Требуется реализовать:** Calendar per master, encrypted tokens, mapping, unique remote event, CRM create/move/cancel via outbox.

**Критерий готовности:** Один appointment — один Google event; outage видим/retryable; CRM remains source of business state.

**Обязательные тесты:** Sandbox OAuth, refresh revoked token, timeout-after-success, duplicate event prevention.

**Зависимости:** Calendar Engine/atomic booking Phase 5, outbox/inbox и provider sandbox; бизнес-истина остаётся CRM.

<a id="step-12-2"></a>

#### 12.2 Inbound / private busy

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §15.

**Файлы/модули:** +src/app/api/webhooks/google-calendar/route.ts; +src/features/google-calendar/server/sync-in.ts; +busy.ts.

**Требуется реализовать:** Webhook signal→incremental sync; channel renewal/token recovery; old/new time through booking lock; reminders rebuild; private Busy.

**Критерий готовности:** Google не меняет payment/medical/no-show/stage/consent/outcome; conflict не перезаписывает silently.

**Обязательные тесты:** Duplicate/out-of-order notifications; expired sync token; conflict-vs-booking; privacy; DST; sync loop.

**Зависимости:** Calendar Engine/atomic booking Phase 5, outbox/inbox и provider sandbox; бизнес-истина остаётся CRM.


### Phase 13 — ежедневная работа, mobile и timeline (§64–66)

<a id="step-13-1"></a>

#### 13.1 Today / Week

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §64–66.

**Файлы/модули:** `src/app/(dashboard)/dashboard/page.tsx`; +src/features/calendar/components/day-week-view.tsx; layout; mobile-bottom-nav.tsx.

**Требуется реализовать:** Вместо quick links — today calendar, Week, Google shortcut; time/client/zone/master/type/status/acconto/received/balance.

**Критерий готовности:** Главный экран обслуживает рабочий день; finance/master scope соблюдён.

**Обязательные тесты:** Today/week/date change; populated multi-master day; phone; balance consistency.

**Зависимости:** Работающие данные и workflows Phase 3–12, включая расчёт баланса и unresolved tasks.

<a id="step-13-2"></a>

#### 13.2 Needs Attention

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §64–66.

**Файлы/модули:** +src/features/attention/server/queries.ts; +components/attention-list.tsx; dashboard.

**Требуется реализовать:** Все 13 категорий §64.3; severity/due/actor/resolve; dedup и актуальность; drill-down к записи.

**Критерий готовности:** Каждое событие ведёт к конкретному действию; погашенная проблема не висит; failed integration видна.

**Обязательные тесты:** Fixtures всех 13; repeated events; resolution/reopen; wrong master; task expiry.

**Зависимости:** Работающие данные и workflows Phase 3–12, включая расчёт баланса и unresolved tasks.

<a id="step-13-3"></a>

#### 13.3 Unified timeline / mobile P0

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §64–66.

**Файлы/модули:** `src/app/(dashboard)/clients/[id]/page.tsx`; `src/components/shared/timeline.tsx`; +src/features/clients/server/timeline.ts; формы календаря/оплаты/takeover/medical.

**Требуется реализовать:** Messages/payments/appointments/stages/docs/photos/medical в одной chronological history с pagination; все §65 actions доступны с телефона.

**Критерий готовности:** Нет horizontal scroll; минимум переходов; история полна без утечки чужих данных.

**Обязательные тесты:** 360/390/430px; клиенты/перенос/pay/media/status/takeover/balance/clearance; pagination stable order.

**Зависимости:** Работающие данные и workflows Phase 3–12, включая расчёт баланса и unresolved tasks.


### Phase 14 — защита данных и эксплуатация (§68,71–73)

<a id="step-14-1"></a>

#### 14.1 Export

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §68,71–73.

**Файлы/модули:** `src/db/schema.ts` exportJobs; +src/features/exports/server/service.ts; +components/export-panel.tsx; +src/app/api/exports/[id]/route.ts.

**Требуется реализовать:** Owner export: client identity/history/cycles/appointments/ledger/docs/media references; protected artifact, audit, expiry.

**Критерий готовности:** Export полон и разрешён только нужному actor; links не раскрывают private files.

**Обязательные тесты:** Export fixture reconciliation; wrong actor; expired URL; failed job recovery.

**Зависимости:** Все data stores, aliases/media/provider mapping и согласованные operational/privacy параметры.

<a id="step-14-2"></a>

#### 14.2 Retention / anonymisation

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §68,71–73.

**Файлы/модули:** +src/features/privacy/server/retention.ts; +anonymisation.ts; +components/privacy-request.tsx; schema.

**Требуется реализовать:** Настраиваемые утверждённые сроки; archived vs anonymised; request/review/execute record; сохранить допустимый финансовый/audit след, обработать aliases/media/logs.

**Критерий готовности:** Не hard-delete linked history; все store locations учтены; destructive execution только после reviewable scope.

**Обязательные тесты:** Preview counts; retries; legal/retention holds как policy; external asset failure; no remaining unintended identity.

**Зависимости:** Все data stores, aliases/media/provider mapping и согласованные operational/privacy параметры.

<a id="step-14-3"></a>

#### 14.3 Backups / storage / monitoring

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §68,71–73.

**Файлы/модули:** +ops/backup-restore.md; +ops/deployment.md; `src/lib/cloudinary.ts`; `src/app/api/health/route.ts`; +src/server/observability.ts.

**Требуется реализовать:** DB+private media restore plan, scheduled backups, encryption/access restrictions, redact logs/errors, worker/dead-letter health.

**Критерий готовности:** Backup реально восстановлен на тестовом окружении; secrets/medical content не в error output; access logs работают.

**Обязательные тесты:** Restore reconciliation IDs/files/balances; denied storage reads; public health safe output; worker restart.

**Зависимости:** Все data stores, aliases/media/provider mapping и согласованные operational/privacy параметры.


### Phase 15 — acceptance и выпуск (§74,76–80)

<a id="step-15-1"></a>

#### 15.1 Technical suite

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §74,76–80.

**Файлы/модули:** +tests/integration/technical-acceptance.test.ts; +tests/e2e/technical.spec.ts; CI.

**Требуется реализовать:** Все technical tests §76, включая AI runtime/policy/tool/RAG/takeover/idempotency: CRUD/archive/history, doubles/slow/retry/webhooks/Google/DST/concurrency, takeover/roles/finance/package/merge/docs/media/backup/export.

**Критерий готовности:** Каждый technical test имеет доказательство фактического результата.

**Обязательные тесты:** Real DB concurrency; controlled fake clocks; providers mocks + sandbox contracts.

**Зависимости:** Все P0 workflows Phase 0–14 и реальные тестовые integrations; каждый пункт приёмки связан с доказательством.

<a id="step-15-2"></a>

#### 15.2 Main E2E

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §74,76–80.

**Файлы/модули:** +tests/e2e/pmu-cycle.spec.ts; tests/e2e/ai-client-agent.spec.ts.

**Требуется реализовать:** Исходные 33 шага §77 плюс AI77.34–48; Human-operated и AI-operated режимы; сообщения, merge, slots, Google, hold, split, balance, фото, care, check-in, review, control, refresh, audit.

**Критерий готовности:** Оба режима имеют одинаковый business state/Appointment contract с ожидаемыми различиями actor/IDs; DB/UI/event/ledger assertions.

**Обязательные тесты:** Happy path + failure/retry, no consent, no payment noted, human correction, mobile.

**Зависимости:** Все P0 workflows Phase 0–14 и реальные тестовые integrations; каждый пункт приёмки связан с доказательством.

<a id="step-15-3"></a>

#### 15.3 Package / Remover E2E

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §74,76–80.

**Файлы/модули:** +tests/e2e/total-face.spec.ts; +tests/e2e/remover.spec.ts.

**Требуется реализовать:** Все пункты §78–79, включая AI13–15 и 10–12; независимые сроки и ручной пересчёт; все Remover outcomes.

**Критерий готовности:** Нет одного общего zone clock; original PMU возвращается.

**Обязательные тесты:** 3 zones, deadline exception, cancelled zone, repeated removals, Wait/Stop/Ready/Repeat.

**Зависимости:** Все P0 workflows Phase 0–14 и реальные тестовые integrations; каждый пункт приёмки связан с доказательством.

<a id="step-15-4"></a>

#### 15.4 Release rehearsal

**Статус:** не завершён; обязательный остаток Phase 3. **Основание:** §74,76–80.

**Файлы/модули:** +ops/release-checklist.md; CI; migration/backfill artifacts.

**Требуется реализовать:** Upgrade копии текущих данных, full acceptance, backup restore, rollback, staged provider checks, итоговый reviewable diff.

**Критерий готовности:** Нет открытых P0/P1 дефектов; каждый P0 §74 принят; production-ready утверждается только с доказательствами.

**Обязательные тесты:** Migration rehearse; smoke all roles; financial reconciliation; release gates.

**Зависимости:** Все P0 workflows Phase 0–14 и реальные тестовые integrations; каждый пункт приёмки связан с доказательством.


### Phase 16 — P2 после рабочего запуска (§75)

<a id="step-16-1"></a>

#### 16.1 Waitlist

**Статус:** не завершён; P2 после запуска. **Основание:** §75.

**Файлы/модули:** +src/features/waitlist/server/service.ts; +components/waitlist.tsx.

**Требования и критерий готовности:** Waitlist + предложение освободившегося слота, без обхода booking lock и takeover.

**Обязательные тесты:** Concurrent claims, opt-out, stale slot.

**Зависимости:** Принятый P0 и отдельное продуктовое решение о запуске соответствующего P2.

<a id="step-16-2"></a>

#### 16.2 Дополнительные пакеты

**Статус:** не завершён; P2 после запуска. **Основание:** §75.

**Файлы/модули:** +src/features/packages/server/skin.ts; +lamination.ts.

**Требования и критерий готовности:** Skin/Laminazione packages с отдельно согласованными ценами/сессиями.

**Обязательные тесты:** Package accounting and no duplicate visits.

**Зависимости:** Принятый P0 и отдельное продуктовое решение о запуске соответствующего P2.

<a id="step-16-3"></a>

#### 16.3 Payment integration

**Статус:** не завершён; P2 после запуска. **Основание:** §75.

**Файлы/модули:** +src/features/payments/adapters/provider.ts; +webhook route.

**Требования и критерий готовности:** Внешний bank/payment provider, reconciliation, идемпотентный ledger.

**Обязательные тесты:** Duplicate/late webhook, charge/refund reconciliation.

**Зависимости:** Принятый P0 и отдельное продуктовое решение о запуске соответствующего P2.

<a id="step-16-4"></a>

#### 16.4 Advanced reports

**Статус:** не завершён; P2 после запуска. **Основание:** §75.

**Файлы/модули:** +src/features/analytics/server/reports.ts; +components/analytics.tsx.

**Требования и критерий готовности:** Расширенная аналитика/advanced reporting поверх ledger и cycles.

**Обязательные тесты:** Aggregation accuracy, master scope.

**Зависимости:** Принятый P0 и отдельное продуктовое решение о запуске соответствующего P2.

<a id="step-16-5"></a>

#### 16.5 Content / automation extension

**Статус:** не завершён; P2 после запуска. **Основание:** §75.

**Файлы/модули:** +src/features/templates/components/library.tsx; +src/features/brochures; automation handlers.

**Требования и критерий готовности:** Expanded template library, brochure version editor, additional automation по отдельным briefs.

**Обязательные тесты:** Version retention, approval, delivery policy, regression P0.

**Зависимости:** Принятый P0 и отдельное продуктовое решение о запуске соответствующего P2.

## 5. Решения владельца до зависимых шагов


Полное ТЗ и расширение AI получены; продолжение больше не требуется. Но в самом тексте есть несколько неоднозначностей. Они не блокируют Phase 0–2; перед зависимым шагом решение должно быть зафиксировано в policy и тесте.

1. §32 Owner создаёт paid correction после 60 дней; §34 Master выбирает Paid correction; §70 Master может создавать correction. Предлагаемый контракт: Master выбирает клиническую необходимость; именно Owner создаёт/оценивает paid correction после 60 дней; free correction одобряет Master. Не расширять права молча.
2. §35 «45 дней после второй процедуры / контрольного решения» содержит два возможных anchor. Хранить оба timestamps и явно выбранный anchor; не превращать ориентир в жёсткий автоматический отказ без решения.
3. §47.2 last performed PMU и §47.3 год после завершения зоны — разные timestamps. Предлагаемый default для refresh clock — lastPerformedPmuAt, completion хранить отдельно; уточнить до 15.2 acceptance.
4. §47.4 не уточняет, входят ли initial offer в 6 attempts. Предложение: отдельный initial offer + до 6 monthly follow-ups; счётчики разделены, после 6 follow-ups stop. Это предложение, не подтверждённое правило.
5. §18 rescheduled — статус и одновременно перенос той же записи. Предложение: rescheduled в истории, текущий визит имеет активный статус/новое время; auto-completion проверяет актуальную версию. Иначе §19 может навсегда исключить перенесённую запись.
6. §24.4 refunds/adjustments/credits требуют единой знаковой модели. Deposit входит в receipts один раз; перенос в credit не новый receipt; excess payment — available credit, не отрицательная задолженность. Это инженерная спецификация ledger, показать примерами до 6.1.
7. Morning reminder hour, consultation-decision timeout, момент фиксации no_response, точный review delay «после второй» и short-notice booking для -7/-3d не заданы. Сделать явными настройками; интервалы «около» не выдавать за жёсткий срок.
8. Working-hour defaults целиком, multi-zone visit duration, single-session non-PMU durations и часть цен-ориентиров не определены точно. Admin/Owner settings/quote без AI назначения цены. Сумма €1650 в §11 ориентировочная, не заменяет сумму реальных выбранных техник.
9. §72 не задаёт retention durations, backup RPO/RTO, правила удаления финансовых/медицинских данных. Требуется владелец policy; произвольный срок не зашивать. Это продуктовая настройка, не юридическое заключение.
10. Не заданы multi-master client sharing и assignment fallback. Owner/Admin назначают; Master по умолчанию только явная связь/свой цикл. Нельзя автоматически открыть всю клиентскую историю всем мастерам студии.


Дополнительно потребуются утверждённые тексты pre-/post-care, FAQ и коммерческих правил, языки обслуживания, рабочие часы/отпуска, Google review URL и доступы к выбранным provider sandbox (WhatsApp/Meta, Google OAuth, OpenAI, storage). Секреты вводятся через защищённые настройки окружения. Код, миграции, интерфейсы, mocks, tests/evals, CI и технические документы может подготовить агент; медицинский/коммерческий контент и решения владельца нельзя выдумывать.

## 6. Финальный Definition of Done

- [ ] Все обязательные §§1–74 и принятый P0 реализованы; P2 не подменяет открытый P0.
- [ ] Закрыт и связан с исполняемыми тестами реестр 125 требований §§76–79. Уже проверенные случаи используются как доказательства в своём объёме, а не пересчитываются как весь PMU E2E.
- [ ] Human-operated и AI-operated пути дают одинаковые domain contracts и конечные состояния. Отдельно проходят Total Face и Remover, включая AI branches.
- [ ] Knowledge Dataset и Evaluation Dataset раздельны. Подготовлены 150–200 содержательных human-reviewed AI scenarios (план: 180); есть версии, holdout, запретные действия/утечки проверены, результаты сохранены. Ноль критических нарушений в тестовом прогоне — release gate, не обещание безошибочности модели во всех будущих разговорах.
- [ ] Повтор команд/webhooks/jobs, double booking, DST, takeover во время отправки, stale context и provider timeout не портят данные и не создают непроверенный повтор внешнего действия.
- [ ] Балансы/credit/refund/package allocations сверяются, история и документы сохраняются, merge охватывает всю финальную схему.
- [ ] Подтверждены private access, role scopes, безопасный экспорт, retention/anonymisation и восстановление backup.
- [ ] Зафиксирован staged release rehearsal и выполнена приёмка владельцем. Зелёный build или наличие enum не заменяет критерии выше.

Порядок реализации: 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15, затем P2. Указанные взаимные зависимости (например hold/credit и AI/Google) означают совместную интеграционную приёмку, а не два источника бизнес-логики.
