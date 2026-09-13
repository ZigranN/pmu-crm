# Phase 3.4c — повторная оценка, возобновление и Lost

14.09.2026. Ветка `codex/phase-3-cycle-reassessment`, база — Phase 3.4b / PR №17.

## Реализовано

- `cycle.review.v1`: idempotent human command, expected cycle version, обязательные reason/comment. Использует MEDICAL_PROFILE_UPDATE + CLIENT_UPDATE и актуальный client/cycle scope. Owner/уполномоченный Master выполняет повторное клиническое решение; Admin и AI запрещены. Ранний административный Lost через прежний generic command сохраняется.
- `reassess`: Thinking, Temporarily unavailable или Lost возвращается к квалификации того же цикла. Специалист заново указывает четыре риска; `evaluateQualification` проверяет реальную same-zone историю, срок ≤2 календарных лет, мастера и состояние клиента. При необходимости цикл получает Consultation Needed, иначе Qualification. Создаётся новая immutable qualification. Это не medical clearance и не выбор слота; следующие booking/medical commands продолжают проверять допуск.
- Специалист может выполнить оценку раньше назначенного контакта при наличии обязательного объяснения; таймер сам никогда не возобновляет цикл. Если состояние по-прежнему не позволяет работу, используется перенос даты с причиной/комментарием из 3.4b, сохраняя suspension.
- `lost`: закрывает ранний запрос/Thinking/Consultation Result с защищённой историей причины. Временная suspension сохраняется до нового решения специалиста. Клиент, cycle ID, исходный result и финансовые snapshots не удаляются и не переписываются.
- Команда блокирует PMU с package, текущими procedure/completion facts, связанным Remover или результатом removal_required. Связанные визиты допускаются только как completed/cancelled consultation без платежных записей. Процедуры, активные визиты и связанные payments/transactions требуют владельцев Calendar/Finance/Remover workflow; данный шаг не отменяет запись и не делает refund.
- `cycle_reviews`: append-only причина, комментарий, actor, command и связь с исходным result; receipt/studio/cycle guards в 0019. Общая stage history/audit содержит нейтральное основание. Подробности доступны через medical read scope/access log.
- `follow_up_closures`: постоянное закрытие напоминаний по исходному решению. При выходе из Thinking/unavailable, при review/Lost и при архивировании клиента открытые follow-up tasks отменяются в той же транзакции. Worker проверяет closure до срока и текущей revision. Повторная доставка, restore клиента или старый reschedule не оживляют прежнюю задачу. Completed/cancelled задачи сохраняются.
- Команды и worker используют общий studio lock: worker до закрытия может создать задачу, которую команда отменит; после закрытия он её не создаёт. Сбой audit/outbox откатывает state, qualification/review, closure и отмену task.
- UI: исходное решение явно обозначено как исходное; актуальная дата скрыта после closure; доступны форма повторного решения и последние 50 записей истории. История полностью сохраняется в БД. Нужны текущие права специалиста.
- Client merge сохраняет review/closure/result/task IDs и канонические связи клиента. Новые таблицы ссылаются на cycle/result, без независимого clientId.

## Проверки

Tests: Thinking/unavailable → reassessment; Lost → reassessment на том же cycle; live history и risk override; immutable result/review/closure; stage/permission/replay guards; зависимости appointment/payment/Remover; queue rollback; competing reschedule/review; worker vs Lost; archive → restore; client merge.

Chromium Thinking и unavailable: human result → перенос с потерей ответа/повтором → Lost → повторная оценка → Consultation Needed, история и исходный result после reload. Calendar prerequisites и начальная task — fixtures. Это не полный PMU booking E2E.

Точные результаты typecheck/lint/build/tests и PostgreSQL/Chromium CI фиксируются в PR на окончательный commit.

## Остаток и rollout

Следующий инкремент **3.4d — срок и условия предложения**. Весь 3.4 остаётся PARTIAL до этой части. Фактическая запись/оплаты/процедуры, medical clearance и полный Remover ready_for_pmu требуют Phase 4–8; исходящие сообщения и production scheduler — Phase 9/10.

Завершены hooks существующих команд; самостоятельного UI/command архивирования treatment cycle пока нет. Произвольные прямые UPDATE в БД не заменяют domain commands. Архивирование клиента после применения 0019 закрывает напоминания; исторические архивирования до 0019 не получают выдуманного actor/closure задним числом и должны быть сверены при rollout.

Merge, миграции/seed Neon и deploy не выполнялись. Миграция 0019 применяется проверками только к изолированным тестовым БД.
