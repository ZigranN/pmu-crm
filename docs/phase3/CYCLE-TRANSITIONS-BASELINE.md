# Phase 3.2 — команды стадий и история циклов

13.09.2026. Ветка `codex/phase-3-cycle-transitions`, основана на Phase 3.1 / PR №13. Реализован механизм команд и доступный ранний путь. На переходе к Consultation Needed пустое назначение цикла наследуется из актуальной карточки клиента, с audit; существующее назначение цикла не заменяется. Поэтому лид без мастера можно квалифицировать после назначения в карточке.

Полный бизнес-путь всех 21 стадий ещё не принят: его обязательные источники данных реализуются в шагах 3.3, 5–7 и 10.

## Реализованные контракты

- `stages.ts`: все 21 стадии §40, русские подписи и направленная матрица допустимых переходов. Матрица задаёт необходимое условие, серверные guards — достаточные. Произвольного Select, который подтверждает оплату или медицинский допуск, нет.
- `server/actions.ts`: `cycle.create.v1` создаёт PMU-цикл brows/eyes/lips с существующим назначенным мастером клиента. Команда не назначает другого мастера, не создаёт package/refresh/remover и не принимает price/stage/clearance.
- `cycle.transition.v1`: строгие id, expectedVersion, target, reason, requestKey. Общий studio lock, текущая capability, client/cycle scope, optimistic concurrency; update + immutable history + audit + outbox + command receipt в одной транзакции. Forbidden/stale ошибки не записывают ни историю, ни receipt/event. Replay проверяет текущий доступ и возвращает исходный результат без отката более новой стадии.
- Scope: Owner/Admin в студии; Master только когда и клиент, и cycle назначены активному связанному master. AI generic actions запрещены. Используются существующие CLIENT_READ/CLIENT_UPDATE, включая explicit deny. Архив клиента/цикла и смена назначения закрывают доступ при повторе запроса.
- `cycle_stage_history`: from/to, actor, timestamp, reason, version, commandId. Каждая версия уникальна; FK receipt отложен до commit. SQL запрещает смену стадии без версии +1 и matching history, перезапись/удаление истории; удаление всей тестовой studio допускает cascade. History не содержит clientId: при merge связь с cycle и исторические IDs не меняются.
- `cycle.stage-recorded.v1`: typed transactional consumer подтверждает конкретную историческую версию через inbox. Это устойчивый event boundary, не отправка сообщения и не имитация post-care/booking/финансов.
- `/deals` и `/deals/[id]`: создание, фильтр по всем стадиям, текущее состояние, доступные переходы с причинами блокировки, история с именем автора; вход из Настройки → Циклы процедур. Mobile layout без горизонтального переполнения. Ключ запроса сохраняется при сетевой ошибке для повтора. При stale version требуется обновить данные.
- Чтения журналируются fail-closed. List/client choices ограничены 500, timeline — последними 1000 событиями; усечение явно показано. Поиск/пагинация большого объёма остаются UI-долгом.

## Доступность переходов

| Путь | Текущий результат / источник |
|---|---|
| Создание → New Lead → Qualification | Работает через команды с reason/history/audit/outbox |
| Qualification → Consultation Needed | Язык, client kind, explicit previous PMU, интересующая зона и активный назначенный мастер обязательны |
| Consultation Needed → Consultation Offered | Человек подтверждает предложение с причиной; внешнее сообщение не отправляется |
| Ранние New Lead / Qualification / Consultation Needed / Offered → Lost | Работает с причиной, только без appointment/procedure links; для приостановленного цикла запрещено |
| Qualification → Procedure Slot Selected | Закрыт до human qualification / eligibility §42 и atomic slot selection (3.3/5) |
| Consultation Scheduled / Confirmed / Completed | Закрыты до Calendar commands; старый appointment.status не принимается как полная бизнес-истина |
| Result Required / Result / Thinking | Закрыты до модели результатов консультации, human guards, follow-up (3.3) |
| Slot Selected / Awaiting Acconto / Procedure Confirmed | Закрыты до booking/hold/ledger (5–6); булевы флаги пользователя не принимаются |
| Session 1 / Session 2 / Control / Completed | Закрыты до проверок процедур, срока 60 дней и решения мастера (7) |
| Refresh Offered / No Response | Закрыты до approved offer/timer events (10) |
| Поздний Lost, возврат из Lost, обратные переходы | Не открыты обходным manual action; сначала нужны правила отмены, refunds/decision и корректирующие команды |

Новые domain commands должны расширить общий transition service вместе с evidence validators, permissions, audit/event contracts и тестами. Снять REQUIRED_COMMAND без этих проверок нельзя. Это не основание считать все стадии production-ready.

## Миграция / проверки

Только новая `0015_cycle_stage_commands.sql` и snapshot; 0014 и применённая история не переписаны. Ручные SQL trigger/deferrability дополнения сохранять при последующих schema изменениях. Neon, seed и merge не выполнялись.

Локально прошли typecheck, lint, 176 unit/integration и 4 migration tests. Проверка PostgreSQL 17 и полного browser suite выполняется в CI на head PR.

`tests/integration/cycle-commands.test.ts`: полная матрица 21×21; public-command запрет каждого protected target; concurrent replay/stale conflicts; rollback audit/outbox; scopes/current deny/archive; legacy clientStatus; immutable history, DB evidence, client merge; versioned worker acknowledgements; payload allowlist; suspension/linked visit/inactive master guards.

`tests/e2e/cycle-commands.spec.ts`: mobile create → Qualification с потерянным ответом и retry → Needed → Offered, заблокированная booking стадия, история и неизменность clientStatus. Полный PMU E2E остаётся Phase 15.

Следующее содержательное расширение — **3.3: qualification, consultation result и human decision contract**, затем 3.4. При этом интеграционные остатки 3.2 сохраняются до подключения календаря, финансов, процедур и автоматизаций.
