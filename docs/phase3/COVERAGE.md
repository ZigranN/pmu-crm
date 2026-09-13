# Матрица покрытия — 80 разделов

Дополнение шага 3.1: ветка `codex/phase-3-cycle-schema`; [объём и проверки](TREATMENT-CYCLE-SCHEMA-BASELINE.md). Исторические сведения о PR №1–12 ниже относятся к предыдущему срезу; применение 0014 в Neon не выполнялось.

Актуализировано 13.09.2026 по коду `eceed9cdbb6a8110c24c983818fc7422570d69af` и рабочему ТЗ 1.1 (исходная версия 1.0 + согласованное расширение AI). Это заменяет устаревшие статусы исходного аудита `6ed762f`; история изменений остаётся в Git и baseline-документах.

Статусы описывают реализацию в текущей ветке, а не rollout. На момент проверки PR №1–6 MERGED; №7–12 OPEN/DRAFT. Применение миграций Neon и состояние Vercel не проверялись. CI окончательного кода: [успешный прогон](https://github.com/ZigranN/pmu-crm/actions/runs/34758447526).

PARTIAL — требование выполнено частично; FOUNDATION — схема без полного workflow; CONFLICT — сохраняющееся расхождение; MISSING — функциональный сценарий отсутствует; MATCH — ограничение соблюдается; DEFERRED — P2; NOT ACCEPTED — итоговая готовность не доказана. «Текущие boundaries/роли реализованы» не закрывает ещё не созданные бизнес-модули. Пути относятся к src/, если не указано иное.

| § | Требование | Статус | Доказательство | Пробел / исправление | Шаги |
|---|---|---|---|---|---|
| 1 | ЦЕЛЬ ЭТАПА | NOT ACCEPTED | Реализованы основы и текущие client/service workflows | Единый путь Lead → Refresh отсутствует | 3–15 |
| 2 | ОСНОВНЫЕ ПРИНЦИПЫ АРХИТЕКТУРЫ | PARTIAL | server/commands/idempotency.ts; server/events/{outbox,worker,registry}.ts; transactional audit | Framework работает; бизнес-события будущих модулей, реальные adapters и общий E2E ещё не подключены | 3–12,15 |
| 3 | ОСНОВНЫЕ СУЩНОСТИ | PARTIAL | Cycle schema + create/transition commands, board/timeline; package shells | Полный cycle workflow, conversations и ledger allocations ещё не приняты | 3.3–3.4,5–10 |
| 4 | КАРТОЧКА КЛИЕНТА | PARTIAL | CLIENT-ADMINISTRATION-BASELINE.md: language, interested zones, kind, reported PMU, assigned/preferred master и strict allowlists | Полная medical/clearance модель — Phase 4; consultation slot — Calendar Phase 5; AI tools — Phase 11 | 2.3,4.1,5.1,11.3 |
| 5 | CLIENT DEDUPLICATION | PARTIAL (текущая схема реализована) | Canonical dedup/merge; registry включает cycles/packages/appointment_cycles с сохранением IDs и snapshots | Будущие conversations/ledger расширяют merge registry; ограничения поиска сохраняются | 6,7,9,15.1 |
| 6 | СПРАВОЧНИК УСЛУГ | PARTIAL | SERVICE-CATALOG-BASELINE.md; нормализованный каталог, FK, sessions, templates | Legacy требует ручного разбора; Calendar Engine подключается в Phase 5 | 2.1,5.1 |
| 7 | МОДЕЛЬ КОЛИЧЕСТВА СЕССИЙ | PARTIAL | serviceDefinitions + services sessionsModel, DB constraints | Session workflow ещё не реализован | 2.1,7.1 |
| 8 | ЦЕНЫ И УСЛУГИ | PARTIAL | 13 определений §8, повторяемый import; quote/estimate/range | Требуется отдельный rollout; legacy не переписываются автоматически | 2.1,2.2 |
| 9 | MASTER-SPECIFIC PRICING | PARTIAL | PRICING-OFFERS-BASELINE.md; resolvePrice + immutable overrides | Effective price реализован; будущий booking должен использовать общий resolver | 2.2,5.1 |
| 10 | CUSTOM OFFER | PARTIAL | Immutable offer revisions и nullable cycle.offerRevisionId с проверкой клиента | Команды применения offer к cycle и ledger ещё не реализованы | 3.2,6.1 |
| 11 | TOTAL FACE | PARTIAL (schema foundation) | Package shell и три уникальные PMU-зоны; multi-cycle visit | Нет atomic создания Total Face,1400,500/400/500,deadline/extension | 8.1,8.2 |
| 12 | REMOVER | MISSING | Enum remover, нет workflow | Нет variable sessions,100/visit,review30–45,outcomes | 8.3,8.4 |
| 13 | КАЛЕНДАРЬ | FOUNDATION | availability/breaks/blockedTimes; schedule заглушка | Нет slot engine/DST/holiday/vacation/override | 5.1 |
| 14 | ПРЕДПОЧТИТЕЛЬНЫЕ СЛОТЫ | MISSING | Нет slot generator | Нет preferred PMU/consultation slots | 5.1 |
| 15 | GOOGLE CALENDAR | MISSING | Нет integration/schema/routes Google | Нет two-way sync/private Busy/conflict protocol | 12.1,12.2 |
| 16 | ЗАЩИТА ОТ DOUBLE BOOKING | MISSING | appointments:check end>start + индексы | Нет server locking/occupancy exclusion | 5.2 |
| 17 | PREFERRED / ASSIGNED MASTER | PARTIAL | clients.assignedMasterId/preferredMasterId; role-management.ts; clients/server/administration.ts; CLIENT-ADMINISTRATION-BASELINE.md | Назначение и история работают; использование при поиске слотов и AI booking ещё не реализовано | 5.1,11.2–11.4 |
| 18 | СТАТУС APPOINTMENT | FOUNDATION/CONFLICT | appointmentStatus 5 значений | Нет требуемого lifecycle/actions; один serviceId | 5.3 |
| 19 | AUTOMATIC COMPLETION | MISSING | Worker framework есть, но completion handler отсутствует | Реализовать scheduled completion, исключения и human correction с причиной | 5.4 |
| 20 | ОПОЗДАНИЕ | MISSING | Нет AI/notifications handlers | Late не обрабатывается | 5.4,11.8 |
| 21 | CONFIRMATION | MISSING | Таблицы templates/notifications без handlers | Нет24h/morning/confirmation_missing; silence rule | 10.1 |
| 22 | SOFT HOLD И ACONTO | MISSING | Нет holds/jobs | Нет awaiting acconto/2h/8h; слот нельзя auto-release | 5.5 |
| 23 | ACONTO | FOUNDATION | paymentTransactions.deposit enum | Нет deposit policy и сохранения credit при no-show/cancel | 6.2 |
| 24 | ПЛАТЕЖИ | FOUNDATION | payments+paymentTransactions | Нет currency/stage/cycle/credit model и posting; баланс не вычисляется сервисом | 6.1,6.2,6.3 |
| 25 | ПРИМЕР PMU PAYMENT FLOW | MISSING | Нет payment UI/business service | Нет flexible first/second/split payment flow | 6.1,7.1 |
| 26 | PAYMENT CHECK | MISSING | Нет payment check handler | Нет вопроса и missing payment attention | 6.4 |
| 27 | REFUND | PARTIAL | lib/permissions.ts: Admin/Master/AI не имеют PAYMENT_REFUND; сервис refund отсутствует | Права ограничены; сам refund, частичный возврат и ledger reconciliation ещё не реализованы | 6.3 |
| 28 | CLIENT CREDIT | MISSING | Нет credit account/allocation | Нет переносимого client credit | 6.2 |
| 29 | DAILY PAYMENT REPORT | MISSING | Нет financial report route/query | Нет дневного отчёта по методам/остаткам/missing/acconto | 6.4 |
| 30 | RECEIPT / INVOICE | MATCH | Нет invoice generator | Официальные документы не генерируются — ограничение сейчас соблюдено | 6.4 |
| 31 | ПЕРВАЯ И ВТОРАЯ PMU ПРОЦЕДУРА | FOUNDATION | procedureSessions.sessionType | Нет cycle clock и правила включённой второй ≤60 дней | 7.1 |
| 32 | ПОСЛЕ 60 ДНЕЙ | MISSING | Нет paid correction command | Нет Owner price/duration/comment/original relation | 7.2 |
| 33 | КОНТРОЛЬ ПОСЛЕ ВТОРОЙ ПРОЦЕДУРЫ | MISSING | Control enum без workflow | Нет планирования30d/30min | 7.3 |
| 34 | РЕЗУЛЬТАТ КОНТРОЛЯ | MISSING | Нет control outcome model/UI | Нет completed/free/paid decision | 7.3 |
| 35 | FREE THIRD CORRECTION | MISSING | Correction enum без approval | Нет free third и45-day guideline | 7.3 |
| 36 | ФОТО ПЕРЕД КОНТРОЛЕМ | MISSING | Нет healed_result/source/verification | Нет запроса за3дня и missing task без отмены | 4.2,10.3 |
| 37 | ФОТОГРАФИИ | PARTIAL | media types before/after; галерея | Нет требуемых stage guards/healed_result/pre-consult rules | 4.2,4.3 |
| 38 | WHATSAPP MEDIA | MISSING | wa.me helper не intake | Нет inbound images и human verification классификации | 9.2,4.2 |
| 39 | CONSENT | PARTIAL/CONFLICT | consents schema/service; upload transaction и archive сохраняют evidence (0.4); UI пока пишет media | Нет multi-zone signature/PDF/versions/review2y и restore UI; hard delete заменён архивированием | 4.4,4.5 |
| 40 | ВОРОНКА PMU | PARTIAL (domain integration) | Cycle engine/UI + qualification/completion/result commands и нейтральная история | Полный booking/finance/procedure/refresh path требует Phase 5–7/10 | 3.4,5–7,10 |
| 41 | КВАЛИФИКАЦИЯ | PARTIAL | Административные поля + specialist qualification с immutable risk/evidence | AI administrative extraction и Calendar booking интеграция ещё не приняты | 5,11 |
| 42 | СУЩЕСТВУЮЩИЙ КЛИЕНТ | PARTIAL | Live same-zone ≤2 calendar years, completed procedure, master и исключения; boundary tests | Booking command должна потреблять актуальную оценку; Calendar отсутствует | 5 |
| 43 | РЕЗУЛЬТАТ КОНСУЛЬТАЦИИ | PARTIAL (domain ready) | Все пять результатов, specialist role, reason/version/receipt/audit, реальный overdue decision task | Реальные calendar prerequisites и scheduler rollout не приняты | 5,10 |
| 44 | CLIENT THINKING | PARTIAL | Thinking outcome и сохранённый followUpAt +7×24h | Реальный follow-up/условия предложения и перенос даты — 3.4 | 3.4,10 |
| 45 | REMOVAL REQUIRED | PARTIAL | Human removal_required создаёт linked Remover и приостанавливает исходный PMU; replay/merge tests | Remover appointments/review/ready_for_pmu restoration ещё отсутствуют | 8.3 |
| 46 | TEMPORARILY UNAVAILABLE | PARTIAL | Human unavailable reason/reassessment/comment, будущая дата и suspension | Задачи повторного контакта, перенос и возобновление — 3.4 | 3.4 |
| 47 | REFRESH | MISSING | Refresh enum без cycle/jobs | Нет350,last same-zone PMU,year offer,monthly6 stop | 10.5 |
| 48 | AI AGENT — ОСНОВНЫЕ ПРАВИЛА | MISSING | Нет AI agent/tools | AI runtime/orchestrator/context builder/registry/KB-RAG/memory/execution trace отсутствуют | 11.1,11.2,11.3,11.5,11.6,11.9,11.10 |
| 49 | AI НЕ МОЖЕТ | PARTIAL (запрет generic actions) | AI_SYSTEM не имеет доступа к существующим generic actions даже через allow override | Нет работающего AI runtime, зарегистрированных tools, server output policy и adversarial acceptance | 11.3,11.4,11.10 |
| 50 | ВОПРОС О ЦЕНЕ | MISSING | Нет AI response policy | Нет adversarial price policy: примерно/диапазон/старый платёж/слова мастера не должны подтверждать цену | 11.4,11.10 |
| 51 | AI И APPOINTMENTS | MISSING | Нет booking actions/AI | Нет AI booking через тот же atomic command Phase5; slot recheck и final transaction guard обязательны | 5.2,5.3,11.3 |
| 52 | НЕСТАНДАРТНОЕ ВРЕМЯ | MISSING | Нет exception workflow | Нет exception_requested + handoff; AI не открывает нестандартное время | 5.1,11.4,11.8 |
| 53 | HUMAN TAKEOVER | MISSING | Нет conversation mode | Нет modes и проверки непосредственно перед outbound; pending/stale queues не контролируются | 11.7 |
| 54 | ESCALATION | MISSING | Нет escalation handler | Нет escalation handler по всем причинам и eval coverage | 11.8,11.10 |
| 55 | COMPLAINT | MISSING | Нет complaints module | Нет atomic complaint takeover+urgent+notify+pause review/send-time guard | 11.8,10.4 |
| 56 | CHANNELS | FOUNDATION | Appointment source enum; wa.me/templates | Нет channel adapters; Google leads только при подключении | 9.1,9.2,9.3 |
| 57 | MESSAGE DELIVERY STATUS | MISSING | Нет messages/delivery states | Нет queued/sent/delivered/read/failed и failed attention | 9.1 |
| 58 | POST-CARE | MISSING | Нет post-care handler | Нет immediate per-zone после session1/2 | 10.2 |
| 59 | CHECK-IN ЧЕРЕЗ 3 ДНЯ | MISSING | Нет check-in handler | Нет day3/no_response без repeat | 10.2 |
| 60 | REVIEW REQUEST | FOUNDATION | reviews table не request flow | Нет one/two-session request timing и complaint pause | 10.4 |
| 61 | GOOGLE REVIEW LINK | MISSING | studios/settings schema | Нет Google review URL в настройках | 10.4 |
| 62 | REVIEW STATUS | CONFLICT | reviewStatus draft/published/archived | Это публикация отзыва, не requested/completed/declined/do_not_remind | 10.4 |
| 63 | PRE-CARE | MISSING | services preparationTemplateId/postCareTemplateId есть; runtime pre-care handler отсутствует | Нет планирования и доставки lips -7/-3 дня, обработки переноса и поздней записи | 10.1 |
| 64 | DASHBOARD | CONFLICT | dashboard — quick links, calendar disabled | Нет today/week, financial rows,13 attention categories | 13.1,13.2 |
| 65 | MOBILE FIRST | PARTIAL | Общий dashboard shell, mobile navigation, forms; client/service/master/merge browser checks 390px | Полный набор P0 действий, calendar/payment/takeover и проверка 360/390/430px ещё не завершены | 5,6,11.7,13.3 |
| 66 | CLIENT TIMELINE | PARTIAL | Client activity timeline; merge переносит события, старые IDs разрешаются | Нет общей paginated истории messages/payments/appointments/stages/docs/media | 13.3 |
| 67 | РОЛИ | PARTIAL (текущие роли реализованы) | lib/roles.ts, lib/permissions.ts; OWNER/ADMIN/MASTER/AI_SYSTEM, legacy mapping, ceilings/deny; ROLE-POLICY-BASELINE.md | Матрицу нужно применять к каждому новому domain command и AI tool | 3–12,15.1 |
| 68 | OWNER | PARTIAL | Owner membership, role management UI, audit/jobs access; role-management.ts | Полноценный export и все будущие бизнес-операции ещё отсутствуют | 14.1,3–12 |
| 69 | ADMIN | PARTIAL (текущие ограничения реализованы) | Admin ограничен capability ceiling; нет refund/medical write/settings; Custom Offer с reason/audit | Будущие calendar/payment/AI workflows требуют реализации и проверок матрицы | 5,6,11,15.1 |
| 70 | MASTER | PARTIAL (текущий scope реализован) | server/auth/scopes.ts; master-scope tests; назначенные клиенты, ограниченные medical/media/finance reads | Новые cycles/booking/ledger commands должны сохранить этот scope; полный Master E2E отсутствует | 3–7,15 |
| 71 | AUDIT LOG | PARTIAL (текущие boundaries реализованы) | writeAudit(tx), sensitiveRead; old/new/reason/actor; audit/access UI; ошибка audit откатывает мутацию | Расширить event contracts на новые модули; retention/экспорт и эксплуатационная защита журналов отдельно | 3–12,14,15 |
| 72 | DATA PROTECTION | PARTIAL | Auth/RBAC, tenant/master scopes, access logs, archive preservation, merge provenance | Нет полного private delivery, retention/anonymisation/export и доказанного backup restore | 4.2,14.1–14.3 |
| 73 | АРХИВИРОВАНИЕ | PARTIAL | Archive вместо удаления клиентов/медиа/согласий; исходные файлы и merge evidence сохранены | Нет полного retention/restore/document version workflow; privacy policy не утверждена | 4.2,4.4,14.2 |
| 74 | P0 — КРИТИЧЕСКИЙ ОБЪЁМ PHASE 3 | MISSING | Большинство P0 только schema или отсутствует | Ни один P0 пакет целиком не принят E2E | 15.4 |
| 75 | P2 | DEFERRED | P2 реализаций нет | Отложено по ТЗ; daily report/export остаются P0 | 16.1,16.2,16.3,16.4,16.5 |
| 76 | ОБЯЗАТЕЛЬНЫЕ TECHNICAL TESTS | PARTIAL (итоговая приёмка открыта) | 150 unit/integration + 4 migration + 13 browser tests на eceed9c; покрыты отдельные integrity/roles/retry/merge случаи | Все 50 technical acceptance scenarios должны быть привязаны к исполняемым тестам и проверены на готовой системе | 15.1,11.10 |
| 77 | END-TO-END ACCEPTANCE TEST | MISSING (сквозной сценарий) | Playwright инфраструктура и 13 браузерных тестов есть; полный PMU E2E отсутствует | Human 33-step PMU и AI77.34–48; равенство конечного business state не доказано | 15.2,11.10 |
| 78 | ОТДЕЛЬНЫЙ END-TO-END TEST TOTAL FACE | MISSING | Нет package/cycles | Total Face business E2E и AI13–15:3 зоны/withdrawal/manual reprice/independent deadlines отсутствуют | 15.3,11.10 |
| 79 | ОТДЕЛЬНЫЙ END-TO-END TEST REMOVER | MISSING | Нет linked remover flow | Remover business и AI10–12:human decision и original PMU restoration отсутствуют | 15.3,11.10 |
| 80 | КРИТЕРИЙ ГОТОВНОСТИ | NOT ACCEPTED | CI eceed9c зелёный, текущие workflows проверены на PostgreSQL 17/Chromium | Нет итоговой приёмки всех P0, реальных integrations/restore/release rehearsal; сборка не равна готовности всей CRM | 15.1–15.4,11.10 |
