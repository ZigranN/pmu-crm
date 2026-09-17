# Phase 1.4 — command receipts, inbox/outbox and worker

13.09.2026. Основание: PR #6 / `codex/phase-1-audit-access`. Merge, seed и миграция Neon не выполнялись.

## Контракт и первый реальный сценарий

`createClientAction(input, requestKey)` теперь требует UUID запроса. Сервер самостоятельно определяет studio/actor, валидирует и нормализует поля, вычисляет SHA-256 канонического JSON. В одной транзакции: client, activity, audit с commandId, outbox event и receipt с результатом `{id}`. Повтор того же actor/studio/command/key возвращает исходный ID; другой payload вызывает conflict. Перед replay повторно проверяются текущие права и доступ к клиенту. Receipt не содержит копии формы или медицинского профиля.

Форма блокирует повторное одновременное выполнение и сохраняет только key/hash в sessionStorage до подтверждённого результата. После потери ответа и reload повтор тех же данных использует прежний ключ. При запрещённом browser storage сохраняется повтор в рамках текущей страницы. Новая форма с другими данными получает новый ключ; похожие люди/номера требуют отдельного deduplication в 2.4.

`idempotentCommand` использует тот же studio lock, что и membership/domain changes. DB callback не должен обращаться к внешним провайдерам. Пока сериализация на студию намеренно консервативна. При масштабировании менять её только с повтором concurrency tests.

## Durable events

- `enqueue(tx, envelope, payload)` атомарен с командой, unique studio/handler/eventKey; конфликт payload/effectType отвергается. AvailableAt сохраняет отложенное время. Повтор не пересоздаёт/не переносит задачу.
- `consumeOnce(tx, studio, consumer, eventKey, payload, handler)` сохраняет receipt вместе с DB effect. Конкурентный duplicate ждёт исходную транзакцию; failed handler не оставляет receipt. Это внутренний API: будущий webhook adapter обязан проверить подпись/источник и определить studio до вызова.
- Claim использует `FOR UPDATE SKIP LOCKED`, lease UUID и deadline. Два worker не владеют одной актуальной lease. Internal handler, inbox и completion выполняются в одной транзакции. Истёкшая internal lease восстанавливается; поздний external result не перезаписывает более новую lease.
- Есть exponential backoff до 300 секунд, лимит попыток, dead letter и история каждой попытки. Неизвестный/изменивший тип обработчик не выполняется. Версии registry immutable: для изменения контракта нужен новый handler ID.
- Все новые временные поля — `timestamptz`, чтобы timezone сервера не сдвигал schedule/lease. Существующие legacy timestamps не преобразовывались.

## Внешние эффекты

`effectType=external` требует отдельного versioned adapter с `send` и `reconcile`. Перед фактическим send adapter обязан проверить актуальные бизнес-условия/takeover/permissions; job.id служит стабильным provider request reference. Таймаут, неожиданный ответ или истёкшая lease после send переводят задачу в `uncertain`. Следующее действие — reconciliation по этому reference, а не повторная отправка.

`safe_to_retry` допустим только при авторитетном доказательстве отсутствия эффекта и отсутствии ещё выполняющейся исходной отправки. Если provider не даёт такой гарантии, adapter возвращает `unknown`. Unknown остаётся Needs Attention после лимита проверок. Ошибки и timeout reconciliation не разрешают resend. Известная ошибка до внешнего эффекта может быть RetryableJobError; PermanentJobError также допустим только при гарантированном отсутствии эффекта. В БД сохраняется код ошибки, не текст ответа/ключи провайдера.

В текущем production registry только `client.created.v1`: внутренний consumer фиксирует приём события в inbox. Он не отправляет сообщения и не имитирует ещё не реализованные automations. External contract проверен на controlled adapters; настоящие WhatsApp/Google/AI handlers добавляются в соответствующих фазах с provider sandbox tests. Это не distributed exactly-once promise для произвольного внешнего API.

## Запуск и восстановление

`POST /api/internal/jobs` — server-only worker entry point с Bearer WORKER_SECRET (не менее 32 символов), не связанным с auth session secret. Без настройки endpoint возвращает 503; без правильного секрета — 401. Один вызов обрабатывает до трёх задач, external attempt ограничен 10 секундами, lease — 60 секунд. Таймер завершает ожидание и передаёт AbortSignal adapter; таймаут не доказывает отсутствие внешнего эффекта.

После будущего применения миграций и настройки окружения trusted scheduler может регулярно вызывать этот POST. Автоматическое расписание/Vercel cron в этом PR не включено. Пока worker не настроен, события остаются durable pending.

`/settings/jobs` доступен только Owner: attention/all, страницы по 50, ограниченная история попыток без payload. Recovery требует причины, выполняется под studio/job locks и сохраняет audit. Pending/processing/completed нельзя переотправить этой кнопкой. Для uncertain recovery только возобновляет reconciliation, не переводит в send. Неактивные студии worker не обрабатывает.

## Проверки и границы

Локально: 85 Vitest tests и 4 migration tests; typecheck/lint/build. Новые сценарии: five concurrent client requests, conflicting payload, revoked replay, audit rollback, inbox/outbox duplicate, two workers, delayed schedule, expired lease, rollback/retry/dead letter, ambiguous delivery and reconciliation, timeout, stale result fencing, Owner recovery and tenant isolation, scheduler auth. Browser scenario проверяет потерю ответа после commit, reload/retry без второго клиента, recovery на 390px; результат real PostgreSQL 17/browser CI фиксируется в PR.

Migration 0008 добавляет четыре таблицы и расширяет audit/access contracts; прежние SQL не меняет. Миграции through 0008 нужны до запуска этой версии приложения; рабочая БД не изменялась.

Framework 1.4 и первый producer готовы. Это не означает готовность idempotency у ещё не созданных appointment/payment/Google/message commands или всех legacy CRUD/upload paths: они должны подключаться при реализации своих доменов. Прямой upload/компенсация Cloudinary остаются в текущем виде до media phase 4.2. Следующий этап — 2.1, каталог услуг и его нормативная модель. Полная приёмка §76–80 остаётся открытой.
