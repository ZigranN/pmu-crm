# PHASE 21.2 — LIVE API INTEGRATION & TEST RUNBOOK

Руководство по настройке и безопасному подключению реальных тестовых окружений:
1. **Meta WhatsApp Cloud API**
2. **OpenAI API**
3. **Google Calendar API**

---

### 1. Архитектурный статус и готовность кодовой базы

| Интеграция | Статус кода | Реальный Live API | Ключевые компоненты |
| :--- | :---: | :---: | :--- |
| **Meta WhatsApp Cloud API** | **READY** | **BLOCKED** *(ожидает тестовые credentials)* | `src/features/whatsapp/server/client.ts`, `src/features/whatsapp/server/webhook-parser.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/features/whatsapp/server/orchestrator.ts` |
| **OpenAI API** | **READY** | **BLOCKED** *(ожидает API key проекта)* | `src/features/ai/providers/production-adapter.ts`, `src/features/ai/domain/guardrails.ts`, `src/features/ai/server/service.ts`, `src/features/whatsapp/server/orchestrator.ts` |
| **Google Calendar API** | **READY** | **BLOCKED** *(ожидает OAuth Client credentials)* | `src/features/google-calendar/server/oauth.ts`, `src/features/google-calendar/server/client.ts`, `src/features/google-calendar/server/service.ts`, `src/app/api/integrations/google-calendar/callback/route.ts` |

---

### 2. Чек-лист переменных окружения (Credentials Checklist)

Добавьте следующие переменные в локальный защищённый файл `.env.local` (файл находится в `.gitignore` и никогда не фиксируется в системе контроля версий):

```env
# ==============================================================================
# 1. META WHATSAPP CLOUD API (TEST ENVIRONMENT)
# ==============================================================================
# Постоянный токен доступа системного пользователя или временный токен из Meta Dashboard
WHATSAPP_ACCESS_TOKEN=your_meta_access_token_here

# Идентификатор тестового телефонного номера (15-значное число из Meta WhatsApp Getting Started)
WHATSAPP_PHONE_NUMBER_ID=your_test_phone_number_id_here

# Идентификатор WhatsApp Business Account (WABA ID)
WHATSAPP_BUSINESS_ACCOUNT_ID=your_waba_id_here

# Секретная строка для верификации Webhook GET-запроса (задаётся вами в Meta App Dashboard)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_custom_secure_verify_token_here

# Секрет приложения Meta (App Secret) для валидации HMAC-SHA256 подписи заголовка X-Hub-Signature-256
WHATSAPP_APP_SECRET=your_meta_app_secret_here

# ==============================================================================
# 2. OPENAI API
# ==============================================================================
# Секретный ключ API OpenAI (рекомендуется Project API Key с лимитом $5)
OPENAI_API_KEY=sk-proj-your_openai_api_key_here

# Модель для консультаций и copilot (по умолчанию: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini

# Базовый URL API (по умолчанию: https://api.openai.com/v1)
OPENAI_BASE_URL=https://api.openai.com/v1

# ==============================================================================
# 3. GOOGLE CALENDAR API (OAUTH 2.0)
# ==============================================================================
# Client ID из Google Cloud Console (тип Web Application)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Client Secret из Google Cloud Console
GOOGLE_CLIENT_SECRET=GOCSPX-your_google_client_secret_here

# Секрет для подписи OAuth state (CSRF защита; если не задан, используется BETTER_AUTH_SECRET)
GOOGLE_CALENDAR_STATE_SECRET=your_google_calendar_state_secret_here
```

---

### 3. Пошаговая инструкция: Meta WhatsApp Cloud API

#### 3.1. Создание приложения в Meta for Developers
1. Войдите в [developers.facebook.com](https://developers.facebook.com).
2. Нажмите **My Apps** → **Create App**.
3. Выберите тип приложения: **Other** → **Business**.
4. В панели управления приложением найдите раздел **WhatsApp** и нажмите **Set up**.

#### 3.2. Получение тестового номера и токена
1. В меню слева перейдите в **WhatsApp** → **API Setup** (Getting Started).
2. Вы увидите:
   - **Temporary access token** (действует 24 часа) или создайте постоянный System User Access Token в Meta Business Manager с правами `whatsapp_business_messaging`.
   - **Phone number ID** (тестовый номер от Meta, например `+1 555 ...`).
   - **WhatsApp Business Account ID**.
3. В поле **To** добавьте ваш личный номер телефона для получения тестовых сообщений и подтвердите его кодом из WhatsApp.

#### 3.3. Настройка Webhook
1. Для локальной разработки запустите туннель (например, `ngrok http 3000` или Cloudflare Tunnel) для получения публичного HTTPS URL.
2. В Meta Developer перейдите в **WhatsApp** → **Configuration** → **Webhook**.
3. Нажмите **Edit**:
   - **Callback URL**: `https://<ВАШ_ПУБЛИЧНЫЙ_ДОМЕН>/api/webhooks/whatsapp`
   - **Verify Token**: значение `WHATSAPP_WEBHOOK_VERIFY_TOKEN` из `.env.local`.
4. Нажмите **Verify and save**. CRM подтвердит запрос через `GET /api/webhooks/whatsapp` с проверкой `hub.challenge`.
5. В списке полей вебхука найдите **messages** и нажмите **Subscribe**.

#### 3.4. Проверка и тестовый вызов
1. **Первый входящий запрос**: отправьте с подтверждённого личного номера в WhatsApp тестовое сообщение:
   - *«Здравствуйте, хочу узнать, как подготовиться к перманентному макияжу бровей»*.
2. **Проверка в CRM**:
   - Откройте страницу `/conversations`.
   - Убедитесь, что создан диалог, входящее сообщение зафиксировано, и сформирован ответ без создания записей или медицинских допусков.
3. **Отключение при ошибке**:
   - В Meta Dashboard нажмите **Unsubscribe** от поля `messages` или очистите `WHATSAPP_ACCESS_TOKEN` в `.env.local`.

---

### 4. Пошаговая инструкция: OpenAI API

#### 4.1. Создание проекта и ключа
1. Войдите в [platform.openai.com](https://platform.openai.com).
2. Перейдите в **Settings** → **Projects** → создайте отдельный проект `pmu-crm-test`.
3. Установите лимит расходов (**Usage limits**): Soft limit `$5`, Hard limit `$10`.
4. Перейдите в **API Keys** → **Create new secret key** с доступом к модели `gpt-4o-mini`.
5. Скопируйте ключ в `OPENAI_API_KEY` в `.env.local`.

#### 4.2. Проверка работы
1. При поступлении входящего сообщения WhatsApp оркестратор вызывает `ProductionAiAdapter.generateText` с контекстом `STUDIO_KNOWLEDGE_BASE`.
2. В панели OpenAI Platform (**Usage**) проверьте появление вызовов модели `gpt-4o-mini` без задержек.
3. **Безопасность**:
   - Ответ проходит валидацию через `sanitizeReplyDraft`.
   - При превышении квоты или отсутствии ключа CRM автоматически возвращает детерминированный регламент студии.

---

### 5. Пошаговая инструкция: Google Calendar API (OAuth 2.0)

#### 5.1. Настройка проекта в Google Cloud Console
1. Войдите в [console.cloud.google.com](https://console.cloud.google.com).
2. Создайте тестовый проект: `pmu-crm-calendar-test`.
3. Перейдите в **APIs & Services** → **Library** → найдите **Google Calendar API** и нажмите **Enable**.
4. Перейдите в **APIs & Services** → **OAuth consent screen**:
   - User Type: **External** (в режиме Testing).
   - Добавьте тестовый Google-аккаунт в список **Test users**.
   - Scopes: добавьте `../auth/calendar.events`, `../auth/calendar.readonly`, `../auth/userinfo.email`, `../auth/userinfo.profile`.

#### 5.2. Создание OAuth Client ID
1. Перейдите в **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. Name: `PMU CRM Test Client`.
4. **Authorized redirect URIs**:
   - `http://localhost:3000/api/integrations/google-calendar/callback`
   - `https://<ВАШ_ПУБЛИЧНЫЙ_ДОМЕН>/api/integrations/google-calendar/callback`
5. Сохраните `Client ID` и `Client Secret` в `.env.local`.

#### 5.3. Подключение и валидация
1. Запустите CRM и войдите под учётной записью администратора/мастера.
2. Перейдите в `/settings/integrations/google-calendar`.
3. Нажмите кнопку **Подключить Google Календарь**.
4. Пройдите авторизацию в Google и предоставьте доступ к тестовому календарю.
5. После редиректа убедитесь, что статус подключения изменился на **Подключено** (`synced`).
6. Создайте запись в CRM и проверьте её появление в Google Календаре.

---

### 6. Сводка Quality Gates

- **Tenant Isolation**: Все внешние вызовы жестко изолированы по `studioId` активной студии.
- **Idempotency**: Все вебхуки и календарные синхронизации защищены от повторной обработки по уникальным `id`.
- **Safety First**: Запрещено автономное создание медицинских допусков, изменение этапов циклов или начисление оплат через AI.
