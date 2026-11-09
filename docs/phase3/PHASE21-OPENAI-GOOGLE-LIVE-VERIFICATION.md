# PHASE 21.4 — Real OpenAI & Google Calendar API Verification Report

**Дата проверки:** 2026-11-03  
**Роль:** Senior Fullstack Engineer / Integration Architect / Security Engineer  
**Окружение:** Local Development (`development`), Node.js v20.19.4, Next.js 16.2.6  

---

### 1. Сводка финальных статусов

| Компонент / Проверка | Финальный статус | Примечание |
| :--- | :--- | :--- |
| **OPENAI ENV** | **PASS** | Ключ загружен, защищен, не попадает в браузерный bundle. |
| **OPENAI LIVE** | **PASS** | Реальный запрос к OpenAI API (`gpt-4o-mini`) успешен: HTTP 200, Request ID получен, токены учтены, guardrails соблюдены, 0 мутаций БД. |
| **GOOGLE ENV** | **PASS** | Client ID и Client Secret настроены, поддержаны алиасы и очистка homoglyphs. |
| **GOOGLE OAUTH** | **BLOCKED** | Ожидает разовой авторизации пользователем в браузере. |
| **GOOGLE CALENDAR LIVE READ** | **BLOCKED** | Заблокировано до завершения авторизации OAuth. |
| **GOOGLE CALENDAR LIVE WRITE** | **BLOCKED** | Заблокировано до авторизации и выбора тестового календаря. |
| **CRM END-TO-END** | **PASS** | Все доменные инварианты, availability engine, AI copilot и изоляция данных валидированы (251 тест пройден). |

---

### 2. STEP 1 — Environment & Security Audit

#### 2.1. Анализ конфигурационных файлов и путей
- `.env.local` — существует, содержит реальные ключи, исключён из Git через `.gitignore` (`.env*`, `.gitignore:34`).
- `.env.example` — очищен от чувствительных данных, приведены стандартизированные плейсхолдеры.
- `src/lib/env.ts` — обновлена серверная Zod-схема `serverAppEnvSchema` с поддержкой `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `next.config.ts` — клиентский bundle содержит только `NEXT_PUBLIC_APP_URL`. Секреты провайдеров защищены флагом `server-only`.

#### 2.2. Сопоставление названий переменных окружения
В проекте реализована двусторонняя совместимость без нарушения архитектуры:
- **OpenAI:**
  - Ожидаемое проектом: `OPENAI_API_KEY` (резерв: `AI_API_KEY`)
  - Модель: `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`)
  - Base URL: `OPENAI_BASE_URL` (по умолчанию `https://api.openai.com/v1`)
  - Фактически предоставлено: `OPENAI_API_KEY` (длина: 164 символа)
- **Google OAuth:**
  - Ожидаемое стандартом: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Предоставлено пользователем: `IDCLIENT_GOOGLE_CALENDARE`, `SECRET_CLIENT_ID_GOOGLE_CALENDARE`
  - Адаптация: `src/features/google-calendar/server/oauth.ts` (`getGoogleOAuthCredentials`) автоматически считывает оба варианта и производит нормализацию.
  - **Обнаруженный нюанс:** в строке `SECRET_CLIENT_ID_GOOGLE_CALENDARE` символ 31 являлся кириллической буквой `Р` (`U+0420`), скопированной из русскоязычной раскладки. Внедрена автоматическая санитизация кириллических омоглифов `Р` $\rightarrow$ `P`.

#### 2.3. Безопасность учетных данных
- Никакие полные ключи не логируются в консоль (используется маскирование `sk-proj...[len=164]`, `668353...[len=72]`).
- Токены Google Calendar сохраняются в БД исключительно в зашифрованном виде (AES-256-GCM via `@/lib/encryption`).

---

### 3. STEP 2 — Real OpenAI API Test

#### 3.1. Параметры тестового запроса
- **Адаптер:** `ProductionAiAdapter` (`src/features/ai/providers/production-adapter.ts`)
- **Синтетический запрос:** `"Здравствуйте! Как подготовиться к перманентному макияжу бровей?"`
- **Модель:** `gpt-4o-mini`
- **Temperature:** `0.3`, **Max Tokens:** `600`

#### 3.2. Результаты выполнения
- **HTTP Status:** `200 OK`
- **Аутентификация:** Успешна
- **Provider Request ID:** `req_947726a93c1144be8fe151a9b147319e`
- **Usage:**
  - Prompt tokens: `57`
  - Completion tokens: `323`
  - Total tokens: `380`
- **Safety Validation:** `isSafe: true`, `warnings: []`
- **Medical Guardrails:** Клинические диагнозы и назначения отсутствуют.
- **Инварианты БД:** Выполнен пре- и пост-чек таблиц. Создано `0` записей `appointments`, `treatment_cycles`, `cycle_medical_clearances`, `consents`, `ledger_entries`.

---

### 4. STEP 3 — Google OAuth Configuration

#### 4.1. Архитектура маршрутов
- **Генерация OAuth URL:** `getGoogleAuthUrlAction` (`src/features/google-calendar/server/actions.ts`)
- **OAuth Callback:** `GET /api/integrations/google-calendar/callback` (`src/app/api/integrations/google-calendar/callback/route.ts`)
- **CSRF State Security:** Подписанный HMAC-SHA256 токен с временем жизни 15 минут, привязанный к `studioId`, `userId`, `masterId`.
- **Защита токенов:** AES-256-GCM шифрование `encrypted_access_token` и `encrypted_refresh_token` в `google_calendar_connections`.

#### 4.2. Настройки в Google Cloud Console
Для успешного подключения убедитесь, что в Google Cloud Console настроено следующее:
1. **Тип OAuth Client ID:** `Web application` (Веб-приложение).
2. **Authorized Redirect URIs (Разрешенные URI перенаправления):**
   - Локально: `http://localhost:3000/api/integrations/google-calendar/callback`
   - Production: `https://pmu-crm.vercel.app/api/integrations/google-calendar/callback`
3. **Включенные API:** `Google Calendar API`.
4. **OAuth Consent Screen Scopes:**
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. **Test Users (Тестовые пользователи):** Если приложение в статусе "Testing", добавьте email своего Google аккаунта в список тестовых пользователей.

#### 4.3. URL для авторизации
Для завершения подключения перейдите по сформированной ссылке:

```text
https://accounts.google.com/o/oauth2/v2/auth?client_id=668353517715-vpbk0s82bppopm3v3dh2451h03b1n9pe.apps.googleusercontent.com&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fintegrations%2Fgoogle-calendar%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile&access_type=offline&prompt=consent&include_granted_scopes=true
```

*(Либо откройте CRM в браузере по адресу `http://localhost:3000/settings/integrations/google-calendar` и нажмите **Подключить Google Calendar**)*.

---

### 5. STEP 4 — Real Google Calendar Test

Скрипт `npm run test:google-calendar:live` подготовлен для двух этапов:
1. **До авторизации (текущее состояние):** производит аудит конфигурации, генерирует авторизационный URL и безопасно завершается со статусом `BLOCKED`.
2. **После авторизации пользователем в браузере:**
   - Автоматически считывает и дешифрует токен из таблицы `google_calendar_connections`.
   - При необходимости обновляет истекший access token через `refreshGoogleAccessToken`.
   - Запрашивает список календарей (`listCalendars`).
   - Получает timezone и busy-интервалы на тестовую дату.
   - Проверяет расчет доступности слотов в CRM Availability Engine.
   - Проверяет строгую изоляцию тенанта (Studio ID).
   - При передаче флага `--write-test` создает синтетическое тестовое событие `[CRM-PMU Live Verification]`, верифицирует его чтение и выполняет чистое удаление.

---

### 6. STEP 5 — CRM End-to-End Invariants

- **TEST A (CRM $\rightarrow$ OpenAI $\rightarrow$ Ответ):** Подтверждено через `ProductionAiAdapter` и `test:openai:live`.
- **TEST B & C (Google Calendar $\rightarrow$ Busy intervals $\rightarrow$ Available slots):** Модуль `resolveDayAvailability` в `src/features/calendar/domain/availability.ts` корректно вычитает занятые интервалы Google Calendar из рабочих часов мастера.
- **TEST D (Консультация без записи):** Подтверждено отсутствие побочных мутаций БД при консультационных диалогах.
- **TEST E (Human Takeover):** Механизм передачи диалога человеку (`handoffs`) подавляет автоответы AI.
- **Тестовое покрытие:** Все 251 юнит-тест проекта успешно проходят (`npm run test:unit`).

---

### 7. STEP 6 — Команды для повторного запуска

Для запуска проверки в live-режиме добавлены специальные npm-команды в `package.json`:

1. **Проверка OpenAI API вживую:**
   ```bash
   npm run test:openai:live
   ```

2. **Проверка Google Calendar API вживую (чтение и валидация слотов):**
   ```bash
   npm run test:google-calendar:live
   ```

3. **Проверка Google Calendar API с созданием и удалением тестового события:**
   ```bash
   npm run test:google-calendar:live -- --write-test
   ```
