# Phase 1.3 — audit and sensitive reads

13.09.2026. Основание: PR #5 / `codex/phase-1-master-scope`. Этот шаг не выполняет merge, seed или миграцию Neon.

## Реализовано

- Все текущие mutations clients, medical, services, masters, studio settings, membership/assignment, media/consent используют общий `writeAudit(tx, ...)`. Contract проверяет action/entity, actor, before/after, reason и источник причины. Изменение и история сохраняются одной транзакцией; исключение не подавляется.
- `reasonSource=user` сохраняет введённую причину membership/assignment. Для обычного CRUD `reasonSource=command` обозначает выполненную команду; это не выдуманный комментарий пользователя.
- `writeActivity(tx, ...)` проверяет тип события по enum. Status change, assignment, archive/restore имеют собственные типы. Архив согласия не называется физическим удалением.
- `sensitiveRead` проверяет активную studio membership и permission, выполняет прежний resource scope, записывает журнал до возврата результата. Ошибка журнала блокирует ответ с данными. List/search/direct client, medical/activity, media/consent, master, appointments/payments/transactions подключены к этому boundary.
- Access log хранит actor ID, studio, operation, target ID, возвращённые ID/count, timestamp и outcome. Не сохраняет поисковый запрос, медицинский текст, URL файла или имена клиентов. `not_returned` не различает отсутствующую и скрытую запись; `denied` означает отказ permission; `error` — ошибку чтения. Непроверенный actor/tenant не создаёт записи в чужой студии.
- `/settings/audit` доступен только Owner, включая серверный query guard. Полные mutation snapshots могут содержать медицинские факты. Есть два журнала, страницы по 50 записей; само чтение журнала также фиксируется.

## Миграция 0007

Добавляет audit contract columns/check/index, четыре activity enum значения и отдельную access_logs table. Старые audit rows сохраняются без изменения содержимого с contractVersion=0; новые записи по умолчанию version=1, обязательные поля проверяются БД. Legacy version не является поддерживаемым API для новых application writes. Старые SQL не переписаны.

Применять после 0004 → 0005 → 0006, до запуска этой версии приложения. Использовать настроенную среду миграций; не удалять DATABASE_URL через `env -u`, если файл `.env.local` не содержит URL. В этой задаче рабочая БД не изменялась.

## Проверки

Локально: typecheck, lint, build:test; 67 Vitest tests и 4 migration tests. Новые проверки: identifiers-only read trace, filtered/denied access, journal failure prevents response, unverified tenant, real old/new status snapshots, invalid audit contract rollback, DB rejects missing reason source, Owner-only tenant-scoped journal. Migration upgrade fixture сохраняет произвольный legacy audit event и отвергает неполную новую запись.

Browser suite расширен: Owner на экране 390px видит assignment audit и access trace; Master получает redirect с `/settings/audit`. Полный browser/real PostgreSQL прогон выполняется CI; результат указан в PR.

## Границы и следующий шаг

Это журнал возврата данных серверной функцией, а не доказательство просмотра человеком или скачивания Cloudinary URL. Вложенные запросы могут создавать несколько записей. Private file delivery, retention/export и защита журнала от привилегированного SQL администратора относятся к последующим этапам. Размер журналов потребует retention policy; новые доменные read/write paths обязаны подключать эти сервисы.

Calendar Engine, ledger, cycle/AI/integration commands ещё не реализованы. Для них потребуются новые action contracts и service actors. Следующий шаг 1.4: idempotency, transactional outbox, worker retries/leases/dead letters. Полная приёмка Phase 3 не закрыта.
