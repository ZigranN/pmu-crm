import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { ShieldCheck, Database, MessageSquare, Lock, UserCheck, AlertCircle, RefreshCw } from "lucide-react";

export const metadata: Metadata = {
  title: "Политика конфиденциальности | PMU CRM",
  description: "Политика конфиденциальности сервиса PMU CRM и порядок обработки персональных данных при интеграции с Meta и Instagram Direct.",
  openGraph: {
    title: "Политика конфиденциальности | PMU CRM",
    description: "Политика конфиденциальности сервиса PMU CRM и порядок обработки персональных данных при интеграции с Meta и Instagram Direct.",
  },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Политика конфиденциальности"
      subtitle="Настоящая Политика определяет порядок сбора, обработки, хранения и защиты персональных данных пользователей сервиса PMU CRM, клиентов студий и пользователей, взаимодействующих со студиями через интеграцию с Meta Platforms (Instagram Direct)."
      activePath="/privacy"
    >
      {/* 1. Общие положения */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <ShieldCheck className="w-5 h-5 text-[#8B6F5A]" />
          <h2>1. Общие положения и оператор персональных данных</h2>
        </div>
        <p>
          Настоящая Политика конфиденциальности (далее — «Политика») распространяется на веб-приложение <strong>PMU CRM</strong>, все сопутствующие сервисы и программные интерфейсы (включая интеграции с платформами Meta Platforms, Inc. / Instagram Direct), используемые для автоматизации работы студий перманентного макияжа.
        </p>
        <p>
          Оператором персональных данных и администратором платформы является:
        </p>
        <div className="bg-[#FAF7F2] border border-[#E6DCD2] rounded-xl p-4 text-xs sm:text-sm space-y-2 font-mono">
          <div><strong>Оператор / Юридическое лицо:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Полное наименование организации / ИП]</span></div>
          <div><strong>ОГРН / ОГРНИП / Регистрационный номер:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[ОГРН/ОГРНИП]</span></div>
          <div><strong>ИНН / КПП:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[ИНН/КПП]</span></div>
          <div><strong>Юридический и фактический адрес:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Юридический адрес организации]</span></div>
          <div><strong>Контактный email по вопросам персональных данных:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[privacy@ваш-домен.com]</span></div>
        </div>
      </section>

      {/* 2. Категории обрабатываемых данных */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Database className="w-5 h-5 text-[#8B6F5A]" />
          <h2>2. Категории и состав обрабатываемых данных</h2>
        </div>
        <p>
          В рамках функционирования CRM-системы обрабатываются следующие категории данных в зависимости от роли субъекта:
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="p-4 rounded-xl border border-[#E6DCD2] bg-[#FAF7F2]/50 space-y-2">
            <h3 className="font-semibold text-sm text-[#2B211B]">А. Пользователи CRM (Сотрудники и мастера)</h3>
            <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
              <li>Фамилия, имя, отчество</li>
              <li>Адрес электронной почты (логин)</li>
              <li>Хеш пароля и сессионные токены</li>
              <li>Роль в студии (Owner, Admin, Master)</li>
              <li>Рабочий график и история действий в системе</li>
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-[#E6DCD2] bg-[#FAF7F2]/50 space-y-2">
            <h3 className="font-semibold text-sm text-[#2B211B]">Б. Клиенты студий перманентного макияжа</h3>
            <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
              <li>Имя, фамилия, контактный телефон</li>
              <li>Адрес электронной почты</li>
              <li>Имя пользователя и идентификатор в Instagram / WhatsApp</li>
              <li>История записей, процедур и визитов</li>
              <li>Информированные согласия и медицинские опросники</li>
              <li>Фотоматериалы процедур (зона нанесения ПМ)</li>
            </ul>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#8B6F5A]/30 bg-[#F4EEE7]/40 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm text-[#2B211B]">
            <MessageSquare className="w-4 h-4 text-[#8B6F5A]" />
            <h3>В. Данные, получаемые при интеграции с Meta (Instagram Messaging API)</h3>
          </div>
          <p className="text-xs sm:text-sm text-[#7A6A5F]">
            При подключении бизнес-аккаунта Instagram и получении входящих обращений через официальный Meta Webhook / Instagram Graph API сервис обрабатывает:
          </p>
          <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
            <li><strong>Идентификатор пользователя в Instagram (IGSID / PSID):</strong> уникальный технический идентификатор диалога, формируемый Meta;</li>
            <li><strong>Имя учетной записи Instagram (@username):</strong> публичное имя профиля пользователя;</li>
            <li><strong>Текст входящих и исходящих сообщений:</strong> содержимое переписки с клиентом для консультации и записи на процедуры;</li>
            <li><strong>Медиавложения:</strong> ссылки на изображения или голосовые сообщения, отправленные пользователем в диалог;</li>
            <li><strong>Служебные метаданные:</strong> идентификатор сообщения (mid), временная метка (timestamp), статусы прочтения и реакции на сообщения.</li>
          </ul>
        </div>
      </section>

      {/* 3. Цели и правовые основания обработки */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <UserCheck className="w-5 h-5 text-[#8B6F5A]" />
          <h2>3. Цели и правовые основания обработки данных</h2>
        </div>
        <p>Обработка данных осуществляется исключительно в следующих целях:</p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-2">
          <li><strong>Организация записи и управление визитами:</strong> ведение расписания мастеров, бронирование слотов на процедуры перманентного макияжа, оформление согласий.</li>
          <li><strong>Коммуникация с клиентами:</strong> предоставление консультаций по процедурам, ответы на вопросы пользователей в Instagram Direct и мессенджерах, информирование о деталях записи.</li>
          <li><strong>Обеспечение безопасности и аудит:</strong> фиксация действий пользователей в журналах аудита безопасности (Audit Log) для защиты от несанкционированного доступа.</li>
          <li><strong>Исполнение требований законодательства:</strong> ведение необходимого бухгалтерского и договорного учета.</li>
        </ul>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Правовыми основаниями обработки являются: согласие субъекта персональных данных, необходимость исполнения договора/соглашения об оказании услуг, а также соблюдение законных интересов оператора при обеспечении безопасности информационной инфраструктуры.
        </p>
      </section>

      {/* 4. Безопасность и интеграция с Meta */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Lock className="w-5 h-5 text-[#8B6F5A]" />
          <h2>4. Меры безопасности и правила взаимодействия с Meta</h2>
        </div>
        <p>
          Сервис PMU CRM соблюдает требования <em>Meta Platform Terms</em> и <em>Developer Policies</em>:
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-2">
          <li><strong>Проверка подлинности вебхуков:</strong> Все входящие вебхуки от Meta проходят криптографическую валидацию цифровой подписи <code>X-Hub-Signature-256</code> с использованием алгоритма HMAC-SHA256 и секретного ключа приложения.</li>
          <li><strong>Шифрование и защита ключей:</strong> Токены доступа и учетные данные третьих сервисов хранятся в зашифрованном виде с применением стойких алгоритмов шифрования.</li>
          <li><strong>Запрет нецелевого использования:</strong> Данные пользователей Instagram не используются для таргетирования несанкционированной рекламы, не объединяются с базами сторонних брокеров данных и не передаются третьим лицам без законных оснований.</li>
          <li><strong>Минимизация логов:</strong> Журналы аудита webhook-событий обезличивают конфиденциальный текст сообщений и фиксируют только структурные метаданные доставки.</li>
        </ul>
      </section>

      {/* 5. Передача данных третьим лицам */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <RefreshCw className="w-5 h-5 text-[#8B6F5A]" />
          <h2>5. Передача данных и третьи лица</h2>
        </div>
        <p>
          Мы не продаем и не сдаем в аренду персональные данные. Передача данных возможна только следующим категориям технических провайдеров (субобработчиков):
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E6DCD2] bg-[#FAF7F2] text-[#2B211B]">
                <th className="p-3 font-semibold">Категория партнера / Сервис</th>
                <th className="p-3 font-semibold">Назначение обработки</th>
                <th className="p-3 font-semibold">Сведения о провайдере</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6DCD2] text-[#7A6A5F]">
              <tr>
                <td className="p-3 font-medium text-[#2B211B]">Meta Platforms, Inc. / Instagram</td>
                <td className="p-3">Обмен сообщениями в Direct, доставка webhook-событий</td>
                <td className="p-3">Meta Platforms, Inc. (США / ЕС)</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-[#2B211B]">Хостинг-провайдер и СУБД</td>
                <td className="p-3">Размещение серверной инфраструктуры и защищенной базы данных</td>
                <td className="p-3 font-mono text-xs bg-amber-50 text-amber-950">[Указать провайдера хостинга и баз данных]</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-[#2B211B]">Облачное хранилище медиа</td>
                <td className="p-3">Хранение защищенных фотографий процедур и согласий</td>
                <td className="p-3 font-mono text-xs bg-amber-50 text-amber-950">[Указать провайдера Cloudinary / S3]</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. Сроки хранения */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <AlertCircle className="w-5 h-5 text-[#8B6F5A]" />
          <h2>6. Сроки хранения данных</h2>
        </div>
        <p>
          Персональные данные хранятся не дольше, чем этого требуют цели обработки, либо в течение сроков, установленных применимым законодательством:
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
          <li><strong>Данные учетных записей CRM:</strong> в течение срока действия договора на использование сервиса студией.</li>
          <li><strong>Данные клиентов и история процедур:</strong> <span className="font-mono text-xs bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Срок хранения данных клиентов, например: 3 года с даты последнего визита либо до поступления требования об удалении]</span>.</li>
          <li><strong>Переписка Instagram Direct:</strong> <span className="font-mono text-xs bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Срок хранения истории сообщений, например: 12 месяцев с момента последнего сообщения]</span>.</li>
        </ul>
      </section>

      {/* 7. Права субъектов данных и DSAR */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <UserCheck className="w-5 h-5 text-[#8B6F5A]" />
          <h2>7. Права субъектов данных (DSAR)</h2>
        </div>
        <p>
          Каждый субъект персональных данных имеет право:
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
          <li><strong>Запросить доступ и экспорт:</strong> получить выгрузку своих персональных данных в машиночитаемом формате (DSAR Export);</li>
          <li><strong>Требовать уточнения:</strong> обновить или исправить неточные сведения;</li>
          <li><strong>Отозвать согласие и запросить удаление/анонимизацию:</strong> потребовать удаления или необратимой анонимизации своих данных (DSAR Anonymization);</li>
          <li><strong>Ограничить обработку:</strong> потребовать временного прекращения обработки данных.</li>
        </ul>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Для реализации указанных прав, а также по вопросам удаления данных, полученных через Meta, ознакомьтесь со специальной страницей <a href="/data-deletion" className="text-[#8B6F5A] underline font-medium">Инструкция по удалению данных</a> либо направьте запрос на <span className="font-mono text-xs bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[privacy@ваш-домен.com]</span>.
        </p>
      </section>

      {/* 8. Контакты и согласование */}
      <section className="space-y-4 border-t border-[#E6DCD2] pt-6">
        <h2 className="text-lg font-semibold text-[#2B211B]">8. Контактная информация</h2>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Вопросы, предложения и требования относительно настоящей Политики конфиденциальности направляются по адресу:
        </p>
        <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E6DCD2] text-xs sm:text-sm space-y-1">
          <p><strong>Email службы приватности:</strong> <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[privacy@ваш-домен.com]</span></p>
          <p><strong>Почтовый адрес для корреспонденции:</strong> <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Почтовый адрес для обращений]</span></p>
          <p><strong>Срок рассмотрения обращений:</strong> не более 30 календарных дней с момента получения запроса.</p>
        </div>
      </section>
    </LegalPageShell>
  );
}
