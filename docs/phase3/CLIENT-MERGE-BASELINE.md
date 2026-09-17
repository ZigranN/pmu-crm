# Phase 2.5 — объединение карточек клиентов

Шаг реализует §5 ТЗ для всех существующих связей схемы. Вход: карточка клиента → «Объединить с другой карточкой». Основная карточка сохраняет ID, исходная становится архивным alias. Разные контакты сами по себе не доказывают одну личность: Owner/Admin подтверждают совпадение, выбирают конфликтующие административные значения и вводят причину.

## Контракт

- Preview и execute проверяют действующую роль Owner/Admin и права CLIENT_READ, CLIENT_UPDATE, CLIENT_ARCHIVE. Deny override действует. Master и AI_SYSTEM не могут объединять. Обе карточки и связанные записи должны принадлежать одной студии. Основная карточка должна быть активной, исходная может быть архивной.
- Preview содержит явные конфликты, количество связей, признак двух медицинских профилей и fingerprint состояния. Выбор требуется для каждого различающегося поля, включая пустое значение. Изменение карточек, связей или предыдущих aliases требует нового preview. Страница показывает имена мастеров при выборе assignment/preference.
- Execute, audit и command receipt находятся в одной транзакции под studio lock. Одна исходная карточка не может быть поглощена дважды. Повтор того же request key и payload возвращает прежний результат; другой payload с прежним ключом отклоняется. UI сохраняет ключ при повторе запроса после потерянного ответа в той же открытой форме.
- Старые ID сохраняются в clients с mergedIntoId. Повторное объединение выравнивает предыдущие aliases на конечную карточку. Self-merge, объединение уже поглощённой карточки и неактивная основная карточка отклоняются. Циклы не создаются domain command; resolver дополнительно проверяет циклы/глубину повреждённых цепочек.
- Старые ссылки на карточку, редактирование, предложения и объединение переходят к действующему ID после проверки текущего scope. Reads appointments/payments/media/medical/activity/offers разрешают alias и проверяют доступ к конечной карточке. Старый assignment исходной карточки не даёт Master доступ к новому владельцу.
- Устаревшие формы записи через исходный ID отклоняются; они не восстанавливают архивный дубль и не перезаписывают выбранные значения основной карточки. Повтор client.create receipt сохраняет прежний ID, который теперь разрешается через alias. Существующий consumer client.created.v1 разрешает ID перед обработкой, сохраняя originalClientId; payload/outbox/inbox/receipt не переписываются.
- Поиск дублей учитывает сохранённые контакты aliases и возвращает основную карточку с её текущим scope. Обычный текстовый поиск по списку клиентов продолжает работать по текущим полям основной карточки.

## История и перенос связей

`merge-registry.ts` классифицирует каждую прямую FK на clients. Тест сравнивает registry с Drizzle schema и требует обновления при добавлении следующего модуля.

Переносятся client assignments/status history, appointments, procedure sessions, media, consents, payments, payment transactions, tasks, notifications, activity, questionnaire responses, reviews, custom offers и duplicate decisions. У всех сохраняются ID и исходное содержимое; меняется client_id. Архивные связанные записи тоже сохраняются. Offer revisions/items, appointment events и другие косвенные связи продолжают ссылаться на прежние ID. Финансовые суммы, signed_at, файлы, Cloudinary public IDs и snapshots визитов не меняются.

Audit/access logs, JSON references в исторических metadata, receipts и события остаются историческими свидетельствами с прежними ID. Их связь с текущим человеком восстанавливается через aliases. Таблица client_merges сохраняет source/target/result snapshots, происхождение выбранных полей, IDs перенесённых записей, actor, reason и fingerprint. DB trigger запрещает переписывание/удаление merge record; исключение — удаление всей студии через отдельный административный/тестовый путь, которого UI не предоставляет.

Прежние LTV/visitCount остаются legacy caches: при merge складываются, даты первого/последнего визита берутся по min/max, ближайшего — min, retention score сбрасывается. Исходные значения сохраняются в snapshots. Это не финансовый ledger и не доказательство точности прежних кэшей; настоящий ledger и reconciliation реализуются в Phase 6. Merge не пытается угадывать, какие финансовые операции являются дублями.

Custom Offer identity меняется только при наличии merge record, созданного в той же транзакции и связывающего именно исходный и основной client ID. Любое другое изменение offer identity, ценовых revisions и items остаётся запрещено.

## Медицинские профили

У клиента может быть один активный профиль и несколько сохранённых исторических. Если у обеих карточек есть активные профили, исходный сохраняется как исторический с прежним ID и всеми значениями; основной остаётся текущим и получает mergeReviewRequired. Merge не выбирает диагноз/допуск и не объединяет медицинские значения автоматически.

Исторические формы доступны только с MEDICAL_PROFILE_READ и scope основной карточки, в режиме read-only. Проверку сохранённых сведений подтверждает Owner/Master с MEDICAL_PROFILE_UPDATE и READ, с причиной и аудитом. Подтверждение сверяет показанную версию профиля: новое изменение или объединение требует обновить страницу. Admin не снимает предупреждение. Это подтверждение рассмотрения истории, а не medical clearance (Phase 4.1).

## Ограничения и следующие фазы

Операция ограничена 1000 связанными строками каждой таблицы суммарно для пары; превышение останавливает весь merge до изменений. Несогласованная legacy принадлежность связанной строки другой студии также блокирует операцию. Автоматического «разъединения» нет; доказательства происхождения сохраняются для разбора ошибки человеком.

Cycles, packages, conversations и новые ledger/doc versions ещё не существуют как завершённые модули. Их фазы обязаны дополнить registry, проверку indirect/JSON references и rich merge fixture. Сейчас нельзя утверждать, что перенос будущих сущностей уже проверен.

Миграция `0013_client_merge.sql` следует за 0012. Она добавляет aliases/merge evidence, заменяет уникальность medical client_id на partial unique active profile и позволяет несколько прошлых duplicate decisions после объединения. Существующие карточки/медицинские сведения не изменяются. Применение в Neon и Git merge не выполнялись.

## Проверки

Typecheck, lint, test build; migration fresh/populated upgrade/repeat с сохранением исходного medical profile. Integration: весь FK registry, rich fixture, суммы и оригиналы, medical history, immutable evidence/offer guard, alias reads/stale writes, same/different key concurrency, stale preview, role/override/tenant boundaries, corrupt legacy relation, chained merge, create retry, rollback, retained contacts, medical acknowledgement/stale version, access-log failure. Browser: 390px, выбор конфликтов, обязательная причина/подтверждение, lost response retry, старый URL, сохранённое activity и provenance. Полный browser suite и PostgreSQL 17 запускаются в CI на одноразовой тестовой БД.

Следующий шаг ROADMAP: 3.1 — схема Treatment Cycles и связей с appointments/packages.
