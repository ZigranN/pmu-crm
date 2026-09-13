# Phase 2.4 — проверка дублей клиентов

Реализован шаг 2.4 ROADMAP, §5 ТЗ. Объединение клиентов, aliases и происхождение выбранных полей остаются шагом 2.5. Git merge и миграция Neon не выполнялись.

## Поведение

- Phone/WhatsApp: новый или изменённый номер требует явного международного префикса `+` либо `00`; пробелы, скобки, точки и дефисы нормализуются. Страна не угадывается. Это синтаксическая проверка E.164, не подтверждение существования номера или его владельца.
- Email: trim + lowercase, без объединения Gmail aliases, удаления точек или plus tags. Instagram: handle, `@handle` или обычная ссылка на профиль instagram.com, регистр не учитывается; произвольные сайты и URL с query/fragment не принимаются.
- Миграция добавляет STORED generated keys и неуникальные индексы. Исходные legacy контакты сохраняются. Неоднозначные местные номера не индексируются как точное совпадение; неизменённые legacy значения не блокируют административное редактирование.
- Совпадение любого контакта — exact contact candidate, включая phone ↔ WhatsApp. Это не доказательство одной личности. Совпадение имени — possible. Для опечаток используется общий префикс из трёх символов и ограниченная edit distance; фонетика и транслитерация не реализованы.
- Результат ограничен 200 записями. Если SQL shortlist превышает лимит, ответ помечается truncated и создание запрещено до уточнения. Нельзя принять неполный список кандидатов.
- При создании проверка и запись выполняются под тем же studio lock, что receipt/domain command. Разные request keys с одинаковыми контактами требуют отдельной проверки. Повтор исходного request key возвращает исходный client ID.
- Owner/Admin могут создать отдельную карточку после просмотра актуального списка и ввода причины. Fingerprint включает actor, studio, контакты и актуальные данные кандидатов. Устаревшее подтверждение требует новой проверки. Решение, создание, audit, receipt и outbox фиксируются одной транзакцией.
- Подтверждение не входит в idempotency payload: после потерянного ответа повтор без него возвращает уже созданную карточку и не меняет исходное решение. Изменение данных с прежним ключом отклоняется.
- Owner/Admin видят в проверке и архивные записи; автоматического восстановления нет. Master видит только доступные активные карточки. Запрос с чужим excludeId отклоняется. AI_SYSTEM не получает доступ к общим client actions.
- При редактировании контакты нормализуются, generated keys обновляются; кнопка «Проверить совпадения» выполняет проверку в текущем scope без самой редактируемой карточки. Автоматического глобального запрета обновления по скрытым для Master совпадениям нет. Это ограничение нельзя трактовать как гарантию отсутствия любых дублей в БД.
- Preview возвращает только минимальные данные для проверки и пишет access log до выдачи результата. Ошибка access log блокирует ответ.

## Модули

`src/features/clients/contacts.ts` и `src/lib/phone.ts` — нормализация. `server/deduplication.ts` — кандидаты и fingerprint. `server/duplicate-actions.ts` — защищённый preview. `server/actions.ts` — atomic create и structured review response. `components/duplicate-review.tsx` и `client-form.tsx` — интерфейс. `src/db/schema.ts` — generated keys и clientDuplicateDecisions. Audit/access contracts расширены в `src/lib/audit-contract.ts`.

## Миграция и проверки

`drizzle/0012_client_deduplication.sql` применяется после 0011; функции canonical key объявлены до generated columns. Миграция пересчитывает ключи для существующих строк без изменения raw контактов и без удаления совпадений. Размер таблицы и время блокировки при backfill нужно оценить на копии данных перед выпуском.

Проверки: JS/SQL parity; legacy preservation; cross phone/WhatsApp; empty fields; similar names; concurrent different request keys; explicit shared contact; replay without confirmation; stale/forged token; archive; cross-studio/Master/AI scope; update key refresh; access-log failure; atomic rollback; bounded result. Migration suite проверяет fresh/upgrade/repeat и неизменность исходных данных. Browser E2E проверяет общий семейный номер, ссылку на существующую карточку, обязательную причину, отдельный ID, audit и экран 390px. Остальные E2E остаются регрессией.

Локальные unit/integration проверки используют PGlite; PostgreSQL 17 и полный Chromium E2E выполняются в CI на одноразовой БД. Успех этих проверок не означает приёмку ещё не реализованных фаз ТЗ или проверку production Neon.
