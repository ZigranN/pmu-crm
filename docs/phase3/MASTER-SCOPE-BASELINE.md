# Phase 1.2 — assignment and master scope

13.09.2026. Основание: PR #4 / `codex/phase-1-role-policy`. Предыдущие PR не смержены на начало работы; этот шаг не выполняет merge, seed или миграции в Neon.

## Поведение

- `clients.assigned_master_id` определяет текущий доступ Master. Композитный FK запрещает назначить мастера другой студии. Старые клиенты остаются без назначения — перенос по старым appointments не угадывается.
- `masters.user_id` привязывается Owner к аккаунту через `/settings/team`. Unique studio/user запрещает неоднозначную привязку к двум профилям. Master без активного профиля/членства не получает клиентов.
- Owner/Admin назначает и передаёт клиента из карточки с причиной. Expected previous master защищает от перезаписи устаревшим экраном. Client assignment/history/audit/activity записываются в одной транзакции.
- Только Owner добавляет уже зарегистрированного участника, меняет роль/активность/привязку. Нельзя отключить или понизить последнего активного Owner, перехватить занятую привязку или привязать чужую студию. Учётная запись не создаётся этим action.
- Списки, search, direct ID, medical/history, media/consent reads фильтруются серверным scope. Membership/role и binding проверяются в SQL, не по клиентскому session role или заранее выбранным ID.
- Master видит только свой профиль мастера; общий каталог услуг остаётся доступным для чтения по SERVICE_READ. Изменение цен и других профилей по-прежнему запрещено capability policy.
- Общий client LTV возвращается Master как null, а не ноль. Query boundaries appointments/payments/transactions дополнительно проверяют мастера визита/процедуры; unattributed/contradictory legacy finance links Master не получает.
- Глобальные mutations каталога/настроек/мастеров также повторно проверяют права под тем же studio lock: параллельная смена роли не обходит запрет. Audit записывается с изменением.
- Client update/archive/restore теперь используют scope и обязательный audit в общей транзакции. Client status history сохраняется; activity использует существующий client_updated с old/new metadata вместо отсутствовавшего enum client_status_changed.
- Upload проверяет scope до provider I/O и после него; потеря доступа вызывает rollback и компенсацию файла. Membership, binding, assignment и client writes сериализуются studio lock. Внутри транзакции все повторные DB checks идут через её executor, без нового auth/DB соединения.

## Migration 0006

Новая assignment column/history, composite master FK, unique master studio/user. Предыдущие SQL не менялись. Если в старых данных несколько профилей привязаны к одному аккаунту студии, migration прекращается; выбрать правильную связь должен Owner, автоматического удаления данных нет. Порядок DDL: supporting unique index до composite FK.

После применения 0004 → 0005 → 0006 Owner должен привязать аккаунты и назначить клиентов. До этого Master не увидит старых клиентов. Не использовать seed как UI изменения членства.

## Проверки

- Migration fresh/upgrade/repeat с прежними client data и grants; composite foreign-studio assignment и duplicate binding отвергаются БД.
- Два мастера одной студии, unassigned client, inactive/unbound profile, чужая студия, lists/search/direct/medical/history.
- Чужие appointments и payments у собственного клиента скрыты; нераспределённые finance records скрыты от Master, видны Owner.
- Запись/загрузка чужому клиенту отклоняется до provider I/O; передача во время upload компенсирует файл и отменяет persistence.
- Admin transfer + audit/history, stale expected assignment, Owner-only membership, last Owner, occupied binding.
- Audit failure откатывает transfer/history; прежние mutation/access/seed tests сохранены.
- Browser 390px: Owner связывает аккаунт через форму, назначает клиента; Master после входа видит assigned client, чужой direct URL даёт 404, `/settings/team` перенаправляет на dashboard. Прежний master edit/search E2E остаётся.

## Границы

Критерий доступа 1.1/1.2 реализован на текущих read/write boundaries. Calendar Engine, полноценный ledger, экспорт, treatment cycles и AI ещё не реализованы и обязаны использовать scopes при появлении. Эти query boundaries не означают готовность календаря или оплаты.

Уже выданные публичные Cloudinary URLs нельзя отозвать одним изменением CRM assignment; private media delivery/retention остаётся частью Phase 7. Этот шаг блокирует получение чужих файлов через CRM, но не меняет delivery policy провайдера.

Следующий шаг 1.3: типизированный audit/access log, чтение чувствительных данных, унификация event contract. Полный Phase 3 acceptance не закрыт этим PR.
