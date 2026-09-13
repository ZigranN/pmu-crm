# Phase 2.3 — административная карточка клиента

Ветка `codex/phase-2-client-administration`, поверх Phase 2.2. Эта задача не выполняет merge, миграции или seed в Neon.

## Реализация

Миграция `0011_client_administration.sql` добавляет nullable language, interested_zones, client_kind, reported_previous_pmu и preferred_master_id. Для старых клиентов значения остаются неизвестными; ничего не выводится автоматически из медицинского профиля или pipeline status. Существующие source и treatment_zone сохраняются.

Форма позволяет выбрать язык, несколько зон из справочника, новый/повторный тип клиента и ответ да/нет/не уточнено о предыдущем PMU со слов клиента. Эти поля показаны в отдельной административной карточке вместе с источником, WhatsApp, назначенным и предпочтительным мастером. Client kind отделён от pipeline status. Старую свободную treatment_zone показываем как legacy reference; новый интерес записываем в interested_zones. Старое поле не переписывается общей формой.

Общий clientSchema стал strict allowlist. UI формирует default values из разрешённых полей, а не отправляет целую DB-строку. Клинические поля, medical clearance, цены, tenant/assignment IDs отклоняются сервером. Пропущенные новые поля в существующих вызовах не затирают данные. Текущие контакты/источник остаются совместимыми; старые значения источника отображаются в форме.

Предпочтительный мастер — пожелание, не назначение. Команда `client.preferred-master.v1` доступна Owner/Admin с CLIENT_UPDATE, проверяет активного мастера своей студии, ожидаемое предыдущее значение и request key. Сохранение, activity и audit выполняются атомарно. DB composite FK предотвращает чужую студию. Предпочтение не изменяет assigned_master_id, историю назначений и Master scope. Имена мастеров выдаются только для уже доступной карточки, без выдачи чужого master profile.

Assigned Master сохраняет право редактировать административные поля своих клиентов; менять предпочтение/назначение не может. Existing human actions остаются закрытыми для AI_SYSTEM. `administrativeQualificationSchema` задаёт отдельный строгий контракт для будущих AI tools: контакты, язык, источник, интерес, тип клиента и reported PMU; без медицинских решений, статусов, заметок, assignment или финансов. Подключение AI runtime остаётся в Phase 11.

## Проверки

122 unit/integration tests и 4 migration tests: новые поля, tri-state PMU, legacy preservation, повторный create, strict allowlists, role/tenant/DB guards, предпочтение без предоставления доступа, stale/replayed preference, audit rollback и сохранение medical profile. Новый браузерный сценарий на 390 px проходит создание административной карточки, выбор preferred master и редактирование с проверкой неизменности clinical record. CI запускает full typecheck/lint/build и browser suite на disposable PostgreSQL 17; итог сверяется с head PR.

## Следующие зависимости

Фото уже находятся в отдельном media-разделе. Выбранный слот консультации должен ссылаться на реальный Appointment через Calendar Engine Phase 5; текстовый псевдослот не добавляется. Полный medical clearance — Phase 4, treatment cycle stages — Phase 3, AI — Phase 11.

Следующий шаг — 2.4: дедупликация по контактам, exact/possible candidates и защита конкурентного создания. Merge — отдельный шаг 2.5.
