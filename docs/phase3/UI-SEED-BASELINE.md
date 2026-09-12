# Phase 0.5 — UI и seed

12.09.2026. Основание: main после PR #2, `4e809117765b628b50c5c4a6db40b60acd6d0538`.
Миграция 0003 подтверждена в Neon read-only. Этот шаг не запускает seed или миграции в Neon.

## Изменения

- Общий server layout получает сессию и активную студию; шапка, поиск и навигация доступны на всех dashboard routes. Вложенный shell dashboard удалён.
- Поиск получает studioId из server context; server permissions остаются обязательными. Устаревшие ответы не заменяют результаты нового запроса. Результаты ведут на read details, а не edit. Enum cast и async route params исправлены ранее в 0.3.
- Desktop navigation и mobile navigation используют общий список. Панель сохранения на телефоне расположена над нижней навигацией; контент имеет нижний отступ.
- Seed выполняется одной транзакцией с advisory lock. Studio slug, role/permission code и role-permission pair — стабильные ключи; demo services имеют nullable seedKey, уникальный внутри студии.
- Demo services отключены по умолчанию. Повторный seed сохраняет отредактированные услуги и студию, не реактивирует существующее membership. Старые demo records принимаются по точному имени только при единственном совпадении; неоднозначность откатывает seed.
- Seed связывает уже зарегистрированного пользователя; пароль не создаёт. Connection string и ошибки драйвера не печатаются. Connection закрывается после выполнения.

## Миграция 0004

Добавляет `services.seed_key` и unique indexes для seed identity и role grants. Перед индексом удаляет только эквивалентные повторные role-permission edges, сохраняя самую старую запись (id — tie-breaker). Другие сущности на grant id не ссылаются. Прежние SQL не изменены. Миграцию нужно применить перед запуском новой версии приложения/seed; в Neon она пока не применена.

## Проверки

- Typecheck, lint, synthetic production build.
- Migration suite: fresh/upgrade/repeat, сохранность client data, неизменность deployed hashes 0000–0003, удаление duplicate grants и запрет повторного insert.
- Seed integration: повтор без дублей; сохранение edited/archive state; adoption legacy id/price; rollback при неоднозначности; membership не реактивируется.
- Browser suite: реальное редактирование мастера с сохранением services, mobile 390px без horizontal overflow/перекрытия save, общий search по category и переход на service details, desktop navigation.
- Окончательный результат PostgreSQL 17/Chromium — CI этого PR; отдельные полные acceptance cases Phase 3 этим не закрываются.

## Следующий шаг

Phase 1.1: role matrix Owner/Admin/Master/AI_SYSTEM, resource/assignment policy и server guards. Текущие legacy seed grants сохраняются до этой миграции политики. Повторный seed восстанавливает отсутствующие legacy default grants: это bootstrap, не интерфейс управления custom permissions.

Этот шаг не завершает общий mobile acceptance §65, календарь, финансы или AI. Coverage исходного аудита и полный acceptance остаются историческим реестром, а не заявлением о готовности продукта.
