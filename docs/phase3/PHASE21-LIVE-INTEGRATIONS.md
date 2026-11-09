# PHASE 21.1 — LIVE API INTEGRATIONS & REAL-WORLD VALIDATION

**Document ID:** `PHASE21-LIVE-INTEGRATIONS`  
**Date:** 2026-11-03  
**Status:** COMPLETE (Integration Foundation Implemented & Verified in Test/Sandbox; Live Production Calls Blocked Pending Real Credentials)  
**Live Provider Status:**
- **WHATSAPP LIVE:** `BLOCKED` (Awaiting Real Meta Business Phone Number ID & Access Token)
- **OPENAI LIVE:** `BLOCKED` (Awaiting Real OpenAI Production API Key)
- **GOOGLE CALENDAR LIVE:** `BLOCKED` (Awaiting Real Google OAuth Client ID & Secret)
- **FULL END-TO-END:** `BLOCKED for Live Providers` / `PASS in Synthetic Integration & Sandbox`

---

### 1. Current Integration Architecture

Система PMU CRM поддерживает три ключевые внешние интеграции, объединенные в единый отказоустойчивый контур:

1. **Meta WhatsApp Cloud API (Graph API v21.0):**
   - **Входящие сообщения (Webhooks):** Эндпоинт `/api/webhooks/whatsapp` принимает входящие события Meta с верификацией подписи `X-Hub-Signature-256` (HMAC-SHA256) и проверкой `hub.challenge`.
   - **Оркестрация и сценарии:** Модуль `src/features/whatsapp/server/orchestrator.ts` выполняет маршрутизацию по подключенному номеру студии (`studios.whatsappNumber`), находит или создает контакт клиента, регистрирует входящее сообщение в неизменяемом леджере диалогов (`conversationMessages`) и направляет сценарий:
     - **Сценарий A:** Консультация по подготовке/уходу без записи (без создания Appointment, TreatmentCycle, MedicalClearance, Consent или финансовых задолженностей).
     - **Сценарий B:** Консультация с запросом доступности и записью (сверка слотов, синхронизация с Google Calendar, защита от повторных webhooks).
     - **Сценарий C:** Human Takeover (перевод диалога на человека, создание срочной задачи в Needs Attention, подавление автоответов AI).
   - **Исходящие сообщения:** Адаптер `MetaWhatsAppCloudApiClient` отправляет текстовые и шаблонные сообщения с проверкой 24-часового сервисного окна (Service Window Policy).

2. **OpenAI API (Copilot & Reasoning):**
   - **Адаптер:** `ProductionAiAdapter` (`src/features/ai/providers/production-adapter.ts`) обеспечивает отказоустойчивое взаимодействие с OpenAI (GPT-4o-mini), тайм-ауты (20s), rate limiting (`globalAiRateLimiter`) и строгую валидацию структурированного JSON.
   - **Детерминированные гардрейлы:** `checkActionProhibitions` (`src/features/ai/domain/guardrails.ts`) аппаратно блокирует попытки AI самостоятельно менять медицинский допуск (`MedicalClearance`), изменять стадии циклов (`TreatmentCycle.stage`), проводить финансовые возвраты или отправлять сообщения без согласования.
   - **База знаний студии:** AI отвечает строго по утвержденным регламентам подготовки и ухода за перманентным макияжем (брови, губы, веки).

3. **Google Calendar API (Two-Way Sync):**
   - **Авторизация:** Google OAuth2 flow (`/api/integrations/google-calendar/callback/route.ts`) с шифрованием refresh-токенов (`AES-256-GCM`).
   - **Синхронизация:** Модуль `src/features/google-calendar/server/service.ts` выполняет вычисление занятости (busy intervals), разрешение конфликтов и синхронизацию внутренних визитов CRM в Google Calendar через Outbox воркер.

---

### 2. Required Credentials & Environment Configuration

| Variable | Purpose | Required For Live | Status in Current Environment | Secret |
| :--- | :--- | :---: | :---: | :---: |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User / Permanent Token | YES | Not set (Using Mock Adapter) | YES |
| `WHATSAPP_PHONE_NUMBER_ID`| Meta WhatsApp Business Phone Number ID | YES | Not set (Using Mock Adapter) | NO |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID | OPTIONAL | Not set | NO |
| `WHATSAPP_APP_SECRET` | App Secret for HMAC webhook verification | YES | Test default | YES |
| `WHATSAPP_VERIFY_TOKEN` | Verification token for Meta webhook GET challenge | YES | Configured (`pmu_whatsapp_verify_token`) | YES |
| `OPENAI_API_KEY` | OpenAI API Key for Copilot & AI reasoning | YES | Not set (Using Fake Provider) | YES |
| `OPENAI_MODEL` | Target OpenAI Model (`gpt-4o-mini` default) | NO | `gpt-4o-mini` | NO |
| `GOOGLE_CLIENT_ID` | Google OAuth2 Client ID | YES | Not set | NO |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 Client Secret | YES | Not set | YES |
| `ENCRYPTION_KEY` | 32-byte AES-256-GCM Master Key for OAuth tokens | YES | Configured / Fallback | YES |

---

### 3. Webhook & OAuth Endpoints

1. **Meta WhatsApp Webhook URL:**
   - **Public URL:** `https://<YOUR_DOMAIN>/api/webhooks/whatsapp`
   - **Verification Token:** `pmu_whatsapp_verify_token` (или значение из `WHATSAPP_VERIFY_TOKEN`)
   - **Webhook Fields:** `messages`
2. **Google Calendar OAuth Callback URL:**
   - **Redirect URI:** `https://<YOUR_DOMAIN>/api/integrations/google-calendar/callback`

---

### 4. Real-World User Scenarios Verification

#### Scenario A — Консультация без записи
- **Входящее сообщение:** *«Здравствуйте, хочу узнать, как подготовиться к перманентному макияжу бровей»*
- **Поведение системы:**
  1. Webhook принимается эндпоинтом `/api/webhooks/whatsapp` и валидируется по HMAC-SHA256.
  2. Определяется студия (`studios.whatsappNumber`) и создается/находится контакт клиента.
  3. Сообщение регистрируется в `conversationMessages`.
  4. Извлекаются регламенты подготовки к перманентному макияжу бровей (исключение кофеина, алкоголя за 24 ч, отказ от пилингов и окрашивания за 7-10 дней).
  5. Формируется безопасный ответ и отправляется клиенту через WhatsApp API.
  6. **Архитектурные инварианты (Проверено в тестах):**
     - Appointments создано: **0**
     - TreatmentCycles создано: **0**
     - MedicalClearances создано: **0**
     - Consents создано: **0**
     - Задолженностей в Ledger создано: **0**

#### Scenario B — Консультация с последующей записью
- **Входящее сообщение:** *«А есть свободное время в пятницу?»*
- **Поведение системы:**
  1. Система определяет запрос доступности мастера.
  2. Проверяются доступные интервалы мастера в активной студии с учетом внутренних визитов и внешней занятости Google Calendar.
  3. Клиенту отправляются подтвержденные доступные слоты (например, 11:00, 14:30, 17:00).
  4. Повторные/дублирующие webhooks идемпотентно дедуплицируются по `providerMessageId` без создания повторных сообщений.

#### Scenario C — Human Takeover (Переключение на человека)
- **Входящее сообщение:** *«Хочу поговорить с администратором»*
- **Поведение системы:**
  1. Распознается запрос связи с администратором / оператором.
  2. В `tasks` формируется срочная задача для сотрудников студии: `Запрос связи с администратором в WhatsApp` (приоритет `urgent`).
  3. Клиенту отправляется автоматическое подтверждение передачи диалога администратору.
  4. При назначении ответственного сотрудника (`assignedUserId`) или переходе в режим Takeover, **любые дальнейшие автоответы AI полностью блокируются (SUPPRESSED_HUMAN_TAKEOVER)**.
  5. Сотрудник видит всю историю диалога в `/conversations` и отвечает вручную.

---

### 5. Multi-Tenant Isolation & Safety Guarantees

- **Изоляция номеров WhatsApp:** Каждый входящий webhook маршрутизируется исключительно в контекст той студии, к которой привязан `whatsappNumber`. Данные клиентов, диалогов и задач Studio A изолированы от Studio B.
- **HMAC Защита:** Поддельные или неподписанные запросы к `/api/webhooks/whatsapp` отклоняются с кодом `401 Unauthorized`.
- **Защита от утечки PII:** В логи и внешние системы не выводятся полные персональные данные, платежные карты или токены сессий.
- **Неизменяемость медицинских инвариантов:** Никакой внешний запрос через WhatsApp или AI-ассистента не может автоматически выставить медицинский допуск (`MedicalClearance`) или обойти стадию `TreatmentCycle.stage`.

---

### 6. Test & Quality Gates Summary

| Уровень проверки | Команда / Сьют | Результат | Метрики |
| :--- | :--- | :---: | :--- |
| **Typecheck** | `npm run typecheck` | **PASS (0)** | 0 ошибок TypeScript (`tsc --noEmit`) |
| **Lint** | `npm run lint` | **PASS (0)** | 0 предупреждений и ошибок ESLint |
| **Phase 21.1 Integration** | `vitest run tests/integration/phase21-live-integrations.test.ts` | **PASS (0)** | 12/12 тестов пройдено (Webhooks, Scenarios A/B/C, Isolation, 24h Window) |
| **Migration Integrity** | `npm run test:migrations` | **PASS (0)** | 4/4 TAP-подтеста пройдено |
| **Schema Drift Check** | `node --test tests/phase02-pg-verify.mjs` | **PASS (0)** | 25/25 проверок, 0 schema drift против `0038_snapshot.json` |
| **AI Safety Evals** | `npm run test:ai-evals` | **PASS (0)** | 11/11 кейсов, 4 атаки заблокировано, 0 галлюцинаций |
| **Vitest Unit & Integration** | `npm test` | **PASS (0)** | 81 файл / 1007 тестов пройдено |
| **PostgreSQL Integration** | `npm run test:postgres` | **PASS (0)** | 54 файла / 742 теста пройдено |
| **Next.js Production Build**| `npm run build:test` | **PASS (0)** | 31 маршрут успешно скомпилирован (Turbopack) |
| **Playwright E2E** | `npm run test:e2e` | **PASS (0)** | 44/44 E2E-теста в Chromium пройдено |

---

### 7. Actions Required from User to Enable Live Mode

Для перехода от изолированного/mock-тестирования к реальным вызовам в live-окружении пользователю необходимо:

1. **Meta WhatsApp Business:**
   - Зарегистрировать WhatsApp Business App в Meta for Developers.
   - Получить постоянный системный токен доступа (System User Access Token) с правами `whatsapp_business_messaging` и `whatsapp_business_management`.
   - Настроить Webhook URL в кабинете Meta: `https://<DOMAIN>/api/webhooks/whatsapp` с Verify Token и подписаться на событие `messages`.
   - Указать в `.env` переменные `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`.
2. **OpenAI API:**
   - Создать API-ключ в аккаунте OpenAI с лимитом расходов.
   - Указать в `.env` переменную `OPENAI_API_KEY`.
3. **Google Cloud Console:**
   - Создать проект в Google Cloud Console и включить Google Calendar API.
   - Создать учетные данные OAuth2 Web Application с Authorized redirect URI: `https://<DOMAIN>/api/integrations/google-calendar/callback`.
   - Указать в `.env` переменные `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

---

**FINAL PHASE STATUS:**
`PHASE 21.1 COMPLETE`
`WHATSAPP LIVE: BLOCKED (Awaiting Live Credentials)`
`OPENAI LIVE: BLOCKED (Awaiting Live Credentials)`
`GOOGLE CALENDAR LIVE: BLOCKED (Awaiting Live Credentials)`
`FULL END-TO-END: BLOCKED for Live Providers / PASS in Test Sandbox`
