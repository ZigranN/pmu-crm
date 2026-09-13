# Матрица покрытия — 80 разделов

Рабочая редакция ТЗ 1.1. Аудит основан на commit `6ed762f`; последующее восстановление миграций описано в [MIGRATION-BASELINE.md](MIGRATION-BASELINE.md). Локальные исправления доступа 0.3 описаны в ACCESS-BASELINE.md. Строки 6–10 обновлены по веткам Phase 2.1/2.2 (см. baseline); это не означает rollout в Neon. Остальная таблица сохраняет исходный аудит. Расширение требований AI не означает их реализацию.

PARTIAL — часть функции; FOUNDATION — схема без workflow; CONFLICT — противоречие; MISSING — отсутствует; DEFERRED — P2; NOT ACCEPTED — готовность не доказана. Пути относятся к src/, если не указано иное.

| § | Требование | Статус | Доказательство | Пробел / исправление | Шаги |
|---|---|---|---|---|---|
| 1 | ЦЕЛЬ ЭТАПА | MISSING | Дерево routes; dashboard/page.tsx | Сквозной путь не существует | 15.2 |
| 2 | ОСНОВНЫЕ ПРИНЦИПЫ АРХИТЕКТУРЫ | MISSING | server/services; нет command/outbox/worker | Audit не event-driven; нет business idempotency | 1.3,1.4 |
| 3 | ОСНОВНЫЕ СУЩНОСТИ | PARTIAL | db/schema.ts:39 таблиц | Нет cycles/packages/conversations, multi-cycle visit; остальные сущности частичны | 3.1,6.1,9.1 |
| 4 | КАРТОЧКА КЛИЕНТА | PARTIAL/CONFLICT | clients medical form/actions; scoped reads (0.3), scoped transactional writes (0.4) | Нет clearance/language/assignment; полная медицинская модель остаётся в Phase 4 | 0.3,1.1,2.3,4.1 |
| 5 | CLIENT DEDUPLICATION | MISSING | clients actions; phone.ts; неуникальные индексы | Нет exact/possible/merge/provenance, create дублируется | 2.4,2.5 |
| 6 | СПРАВОЧНИК УСЛУГ | PARTIAL | SERVICE-CATALOG-BASELINE.md; нормализованный каталог, FK, sessions, templates | Legacy требует ручного разбора; Calendar Engine подключается в Phase 5 | 2.1,5.1 |
| 7 | МОДЕЛЬ КОЛИЧЕСТВА СЕССИЙ | PARTIAL | serviceDefinitions + services sessionsModel, DB constraints | Session workflow ещё не реализован | 2.1,7.1 |
| 8 | ЦЕНЫ И УСЛУГИ | PARTIAL | 13 определений §8, повторяемый import; quote/estimate/range | Требуется отдельный rollout; legacy не переписываются автоматически | 2.1,2.2 |
| 9 | MASTER-SPECIFIC PRICING | PARTIAL | PRICING-OFFERS-BASELINE.md; resolvePrice + immutable overrides | Effective price реализован; будущий booking должен использовать общий resolver | 2.2,5.1 |
| 10 | CUSTOM OFFER | PARTIAL | offers UI/commands, immutable revisions, reason/approval/audit | Client-level offer реализован; ссылки cycle/ledger подключаются в своих фазах | 2.2,3.1,6.1 |
| 11 | TOTAL FACE | MISSING | Enum total_look, нет package | Нет3 cycles,1400,500/400/500,deadline/extension | 8.1,8.2 |
| 12 | REMOVER | MISSING | Enum remover, нет workflow | Нет variable sessions,100/visit,review30–45,outcomes | 8.3,8.4 |
| 13 | КАЛЕНДАРЬ | FOUNDATION | availability/breaks/blockedTimes; schedule заглушка | Нет slot engine/DST/holiday/vacation/override | 5.1 |
| 14 | ПРЕДПОЧТИТЕЛЬНЫЕ СЛОТЫ | MISSING | Нет slot generator | Нет preferred PMU/consultation slots | 5.1 |
| 15 | GOOGLE CALENDAR | MISSING | Нет integration/schema/routes Google | Нет two-way sync/private Busy/conflict protocol | 12.1,12.2 |
| 16 | ЗАЩИТА ОТ DOUBLE BOOKING | MISSING | appointments:check end>start + индексы | Нет server locking/occupancy exclusion | 5.2 |
| 17 | PREFERRED / ASSIGNED MASTER | MISSING | clients нет assigned_master_id | Нет запрета AI assignment и master-based slots | 2.3,1.2,11.4 |
| 18 | СТАТУС APPOINTMENT | FOUNDATION/CONFLICT | appointmentStatus 5 значений | Нет требуемого lifecycle/actions; один serviceId | 5.3 |
| 19 | AUTOMATIC COMPLETION | MISSING | Нет scheduler/completion service | Нет auto-completion/исправления reason/history | 5.4 |
| 20 | ОПОЗДАНИЕ | MISSING | Нет AI/notifications handlers | Late не обрабатывается | 5.4,11.8 |
| 21 | CONFIRMATION | MISSING | Таблицы templates/notifications без handlers | Нет24h/morning/confirmation_missing; silence rule | 10.1 |
| 22 | SOFT HOLD И ACONTO | MISSING | Нет holds/jobs | Нет awaiting acconto/2h/8h; слот нельзя auto-release | 5.5 |
| 23 | ACONTO | FOUNDATION | paymentTransactions.deposit enum | Нет deposit policy и сохранения credit при no-show/cancel | 6.2 |
| 24 | ПЛАТЕЖИ | FOUNDATION | payments+paymentTransactions | Нет currency/stage/cycle/credit model и posting; баланс не вычисляется сервисом | 6.1,6.2,6.3 |
| 25 | ПРИМЕР PMU PAYMENT FLOW | MISSING | Нет payment UI/business service | Нет flexible first/second/split payment flow | 6.1,7.1 |
| 26 | PAYMENT CHECK | MISSING | Нет payment check handler | Нет вопроса и missing payment attention | 6.4 |
| 27 | REFUND | FOUNDATION/CONFLICT | refund enum; seed Admin gets all permissions | Нет refund service; Admin получает PAYMENT_REFUND вопреки ТЗ | 1.1,6.3 |
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
| 40 | ВОРОНКА PMU | CONFLICT | clients.clientStatus и ручной Select | Нет21-stage per-zone pipeline; stages человека не цикл | 3.1,3.2 |
| 41 | КВАЛИФИКАЦИЯ | PARTIAL | clients contact/source/interest | Нет formal qualification/language/master/consultation decision | 2.3,3.3 |
| 42 | СУЩЕСТВУЮЩИЙ КЛИЕНТ | MISSING | Нет qualification history rules | Нет same-zone≤2yr shortcut и исключений | 3.3 |
| 43 | РЕЗУЛЬТАТ КОНСУЛЬТАЦИИ | MISSING | Нет consultations module | Нет5 результатов решения мастера | 3.3 |
| 44 | CLIENT THINKING | MISSING | nextContactAt только поле | Нет thinking7d и offer validity handling | 3.4 |
| 45 | REMOVAL REQUIRED | MISSING | Нет linked cycles | Remover не связан с сохранённым PMU | 3.1,8.3 |
| 46 | TEMPORARILY UNAVAILABLE | MISSING | Нет unavailable state | Нет reason/reassessment/comment мастера | 3.4 |
| 47 | REFRESH | MISSING | Refresh enum без cycle/jobs | Нет350,last same-zone PMU,year offer,monthly6 stop | 10.5 |
| 48 | AI AGENT — ОСНОВНЫЕ ПРАВИЛА | MISSING | Нет AI agent/tools | AI runtime/orchestrator/context builder/registry/KB-RAG/memory/execution trace отсутствуют | 11.1,11.2,11.3,11.5,11.6,11.9,11.10 |
| 49 | AI НЕ МОЖЕТ | MISSING | Нет AI policy | Нет server-side tool authorization и outbound policy; medical/financial/late-session/free-third запреты не реализованы | 11.3,11.4,11.10 |
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
| 63 | PRE-CARE | MISSING | Нет pre-care job/template association | Нет lips-7/-3 дней | 10.1 |
| 64 | DASHBOARD | CONFLICT | dashboard — quick links, calendar disabled | Нет today/week, financial rows,13 attention categories | 13.1,13.2 |
| 65 | MOBILE FIRST | PARTIAL | MobileBottomNav/FormActionBar/components | Общий shell только dashboard; основные P0 workflows отсутствуют | 0.5,13.3 |
| 66 | CLIENT TIMELINE | PARTIAL | Timeline последних20 activityEvents | Нет общей истории messages/payments/appointments/photos/docs | 13.3,1.3 |
| 67 | РОЛИ | CONFLICT | SUPER_ADMIN/STUDIO_ADMIN/MASTER/ASSISTANT/CLIENT | Нет явных OWNER/ADMIN/AI_SYSTEM; legacy mapping не задан | 1.1 |
| 68 | OWNER | FOUNDATION | SUPER_ADMIN bypass только при membership | Нет studio OWNER и экспорт/role management UI/workflow | 1.1,1.2,14.1 |
| 69 | ADMIN | CONFLICT | seed Admin all permissions | Admin имеет refund/settings; нужен точный набор | 1.1 |
| 70 | MASTER | CONFLICT | clients queries только studio scoped | Master не ограничен своими клиентами; нет assignment/scope | 1.2 |
| 71 | AUDIT LOG | PARTIAL/CONFLICT | auditLogs/сервис ошибки проглатывает | Нет обязательных old/new/reason по всем действиям и atomicity | 1.3 |
| 72 | DATA PROTECTION | PARTIAL | Auth и storage upload; exportJobs table | Нет private delivery policy/access logs/retention/anonymisation/export/verified backups | 1.1,1.3,4.2,14.1,14.2,14.3 |
| 73 | АРХИВИРОВАНИЕ | PARTIAL/CONFLICT | Archive CRUD есть; consent hard delete/cloud destroy | Нет единой preservation policy для истории и оригиналов | 0.4,4.2,4.4,14.2 |
| 74 | P0 — КРИТИЧЕСКИЙ ОБЪЁМ PHASE 3 | MISSING | Большинство P0 только schema или отсутствует | Ни один P0 пакет целиком не принят E2E | 15.4 |
| 75 | P2 | DEFERRED | P2 реализаций нет | Отложено по ТЗ; daily report/export остаются P0 | 16.1,16.2,16.3,16.4,16.5 |
| 76 | ОБЯЗАТЕЛЬНЫЕ TECHNICAL TESTS | MISSING | Инфраструктура 0.2 и access regression suite 0.3; полная acceptance suite §76 отсутствует | Все technical scenarios, включая76.26–50 AI runtime/policy/RAG/tools/evidence, требуют реализации | 15.1,11.10 |
| 77 | END-TO-END ACCEPTANCE TEST | MISSING | Нет E2E infrastructure/workflows | Human33-step PMU + отдельный AI77.34–48; одинаковый business state не доказан | 15.2,11.10 |
| 78 | ОТДЕЛЬНЫЙ END-TO-END TEST TOTAL FACE | MISSING | Нет package/cycles | Total Face business E2E и AI13–15:3 зоны/withdrawal/manual reprice/independent deadlines отсутствуют | 15.3,11.10 |
| 79 | ОТДЕЛЬНЫЙ END-TO-END TEST REMOVER | MISSING | Нет linked remover flow | Remover business и AI10–12:human decision и original PMU restoration отсутствуют | 15.3,11.10 |
| 80 | КРИТЕРИЙ ГОТОВНОСТИ | NOT ACCEPTED | Build проходит; runtime не проверен | AI не источник истины; UI/AI/automation/integration общий command; acceptance/eval gate не пройден | 15.1,15.2,15.3,15.4,11.10 |
