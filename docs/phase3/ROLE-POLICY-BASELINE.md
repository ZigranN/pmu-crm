# Phase 1.1 — server role policy

13.09.2026. Ветка основана на PR #3 (Phase 0.5), который на начало работы ещё открыт. PR этого шага сравнивается с веткой PR #3, а не включает повторно его изменения. Merge и миграции Neon этим шагом не выполняются.

## Реализовано

- Канонические membership roles: OWNER / ADMIN / MASTER / AI_SYSTEM. Авторитет — активное членство в активной студии; auth user.role остаётся историческим полем, не дающим прав. Dashboard/header показывают роль членства.
- Явный runtime mapping: SUPER_ADMIN → OWNER, STUDIO_ADMIN → OWNER, ASSISTANT → ADMIN, CLIENT → без CRM-роли. Первые две роли исторически имели полный доступ. ASSISTANT сохраняет собственные DB grants под ограничениями ADMIN. Membership IDs, роли старых memberships и auth metadata не переписываются массово.
- OWNER имеет полный доступ только в своей студии. Неактивное membership/studio и неизвестный permission запрещены.
- ADMIN: administrative client/calendar/payment/media/consent/task operations, medical read. Нет medical write/clearance, refund, role management, global service price edits или system settings. Agreed price/Custom Offer появятся отдельными commands в 2.2 с reason/audit.
- MASTER: operational capabilities (medical write, procedure, stage completion, own payment operations по будущему resource scope). Refund/global pricing/settings запрещены.
- AI_SYSTEM: нет доступа к существующим generic actions, даже через allow override. Регистрация AI actor и разрешённые typed commands добавляются в Phase 11; это не готовый AI runtime.
- Ограничения канонической роли проверяются до DB grants/allow overrides. Для обычных разрешённых действий exact deny сильнее allow. OWNER сохраняет полный доступ. Database-defined custom roles пока сохраняют explicit grants — UI управления ими входит в 1.2.
- Регистрация создаёт CLIENT metadata; `input: false` не позволяет выбрать privileged auth role через signup/update-user. Серверный role lookup не доверяет session role.
- Seed использует канонические роли; initial membership создаёт OWNER только при отсутствии существующего membership. Default grants берутся из общей матрицы.

## Миграция 0005

- Unique key user/studio/permission для custom override.
- Среди конфликтующих старых записей сохраняется deny; среди одинаковых — oldest createdAt/id. Ссылок на override ID из других сущностей нет.
- Добавляет канонические role records, permissions и default grants без удаления исторических ролей/членств. Старые SQL не изменены.
- Применять после 0004, перед запуском новой версии. Сброс БД и db:generate при развёртывании не нужны.

## Проверки

- Все существующие permissions × четыре canonical roles через hasPermission на реально мигрированной БД.
- Allow override не обходит запреты ADMIN/MASTER/AI; разные permission overrides не смешиваются; inactive/cross-studio/unknown permission запрещены.
- Реальная Better Auth регистрация/сессия, HTTP forged signup и update-user не дают privileged role.
- Fresh/legacy/repeated migration: старые conflicting overrides сохраняют deny, повторная запись отвергается unique index.
- Предыдущие access/mutation/seed tests и browser master/search/navigation E2E остаются обязательными. CI запускает PostgreSQL 17 и Chromium.

## Граница готовности

**Полный критерий 1.1 ещё зависит от 1.2.** Текущая модель клиента не хранит полноценное назначение мастера/историю передачи. Поэтому этот PR подтверждает capability policy, но НЕ заявляет, что Master уже ограничен своими клиентами или финансами. До реализации и проверки 1.2 доступ мастеров к реальным данным нельзя считать соответствующим §70.

Следующий шаг: assignment model/history, binding masters.userId, server scopes для lists/search/direct IDs/medical/media/consents и Owner-only membership UI с audit. Финансы/appointments последующих фаз обязаны вызывать те же scopes.
