import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { Trash2, Mail, Settings, ShieldCheck, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Инструкция по удалению данных Meta | PMU CRM",
  description: "Инструкция по запросу на удаление и анонимизацию пользовательских данных, полученных через интеграцию с Meta Platforms и Instagram Direct.",
  openGraph: {
    title: "Инструкция по удалению данных Meta | PMU CRM",
    description: "Инструкция по запросу на удаление и анонимизацию пользовательских данных, полученных через интеграцию с Meta Platforms и Instagram Direct.",
  },
};

export default function DataDeletionPage() {
  return (
    <LegalPageShell
      title="Инструкция по удалению данных Meta / Instagram"
      subtitle="В соответствии с правилами платформы Meta (Meta Platform Terms) и требованиями законодательства о защите персональных данных, данная страница описывает порядок удаления и анонимизации данных пользователей, взаимодействующих с сервисом PMU CRM через Instagram Direct."
      activePath="/data-deletion"
    >
      {/* 1. Порядок обработки запросов */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Trash2 className="w-5 h-5 text-[#8B6F5A]" />
          <h2>1. Как обрабатываются данные и запросы на удаление</h2>
        </div>
        <p>
          Сервис <strong>PMU CRM</strong> обрабатывает сообщения и идентификаторы профилей пользователей Instagram исключительно для обеспечения клиентской поддержки, консультирования и записи на процедуры в подключенных студиях перманентного макияжа.
        </p>
        <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#E6DCD2] text-xs sm:text-sm text-[#7A6A5F] flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#8B6F5A] shrink-0 mt-0.5" />
          <div>
            <strong className="text-[#2B211B] block mb-1">Регламент выполнения:</strong>
            Удаление и анонимизация данных производятся администратором сервиса или студии по обращению пользователя (DSAR) с последующей необратимой анонимизацией персональных идентификаторов в базе данных CRM.
          </div>
        </div>
      </section>

      {/* 2. Пошаговые способы удаления */}
      <section className="space-y-6">
        <div className="text-lg font-semibold text-[#2B211B]">
          <h2>2. Способы направления запроса на удаление данных</h2>
        </div>

        {/* Способ 1: Прямой запрос */}
        <div className="p-5 rounded-xl border border-[#E6DCD2] bg-white space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm sm:text-base text-[#2B211B]">
            <div className="w-7 h-7 rounded-full bg-[#8B6F5A] text-white flex items-center justify-center text-xs font-bold">
              1
            </div>
            <h3>Способ 1: Направление прямого запроса в службу поддержки (Рекомендуемый)</h3>
          </div>
          <p className="text-xs sm:text-sm text-[#7A6A5F]">
            Вы можете запросить полное удаление и анонимизацию ваших данных, отправив письмо на наш адрес электронной почты по защите данных:
          </p>
          <div className="bg-[#FAF7F2] p-4 rounded-lg border border-[#E6DCD2] text-xs sm:text-sm space-y-2">
            <div className="flex items-center gap-2 text-[#2B211B] font-medium">
              <Mail className="w-4 h-4 text-[#8B6F5A]" />
              <span>Email для запросов:</span>
              <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[privacy@ваш-домен.com]</span>
            </div>
            <div>
              <strong>Тема письма:</strong> <code className="bg-white px-2 py-0.5 rounded border border-[#E6DCD2]">Запрос на удаление данных Meta / Instagram</code>
            </div>
            <div className="text-[#7A6A5F]">
              <strong>В теле письма укажите:</strong>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>Ваш никнейм в Instagram (например, <code>@username</code>);</li>
                <li>Номер телефона (если вы указывали его при записи на процедуру);</li>
                <li>Наименование студии, в которую вы обращались (если применимо).</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Способ 2: Отзыв разрешений в Instagram */}
        <div className="p-5 rounded-xl border border-[#E6DCD2] bg-white space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm sm:text-base text-[#2B211B]">
            <div className="w-7 h-7 rounded-full bg-[#8B6F5A] text-white flex items-center justify-center text-xs font-bold">
              2
            </div>
            <h3>Способ 2: Отзыв разрешений приложения в настройках Instagram / Facebook</h3>
          </div>
          <p className="text-xs sm:text-sm text-[#7A6A5F]">
            Если вы ранее предоставляли разрешения приложению через учетную запись Meta:
          </p>
          <ol className="list-decimal list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-2">
            <li>Откройте профиль <strong>Instagram</strong> или <strong>Facebook</strong> и перейдите в <strong>Настройки</strong>.</li>
            <li>Выберите раздел <strong>«Настройки и конфиденциальность»</strong> → <strong>«Разрешения для сайтов» / «Приложения и сайты»</strong>.</li>
            <li>В списке активных интеграций найдите <strong>PMU CRM</strong>.</li>
            <li>Нажмите кнопку <strong>«Удалить» (Remove)</strong>.</li>
            <li>После отзыва доступа интеграция прекращает получение любых новых событий и сообщений вашего профиля.</li>
          </ol>
        </div>

        {/* Способ 3: Обращение в студию */}
        <div className="p-5 rounded-xl border border-[#E6DCD2] bg-white space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm sm:text-base text-[#2B211B]">
            <div className="w-7 h-7 rounded-full bg-[#8B6F5A] text-white flex items-center justify-center text-xs font-bold">
              3
            </div>
            <h3>Способ 3: Личное обращение в студию перманентного макияжа</h3>
          </div>
          <p className="text-xs sm:text-sm text-[#7A6A5F]">
            Вы также можете обратиться напрямую к администратору студии, в которую производилась запись. Администратор студии инициирует регламентную процедуру анонимизации карточки клиента через встроенный инструмент управления приватностью PMU CRM.
          </p>
        </div>
      </section>

      {/* 3. Что происходит с данными при удалении */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <ShieldCheck className="w-5 h-5 text-[#8B6F5A]" />
          <h2>3. Объем удаляемых и анонимизируемых данных</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          При обработке запроса на удаление данных выполняются следующие технические действия:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="p-3.5 rounded-lg border border-[#E6DCD2] bg-[#FAF7F2]/60 text-xs sm:text-sm space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[#2B211B]">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Удаляется и анонимизируется:</span>
            </div>
            <ul className="list-disc list-inside text-[#7A6A5F] space-y-0.5">
              <li>Имя, фамилия, номер телефона, email;</li>
              <li>Привязка к Instagram ID (IGSID/PSID);</li>
              <li>Никнейм (@username) и аватар профиля;</li>
              <li>История переписки в диалогах CRM.</li>
            </ul>
          </div>

          <div className="p-3.5 rounded-lg border border-[#E6DCD2] bg-[#FAF7F2]/60 text-xs sm:text-sm space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[#2B211B]">
              <Clock className="w-4 h-4 text-[#8B6F5A]" />
              <span>Сроки и подтверждение:</span>
            </div>
            <p className="text-[#7A6A5F]">
              Запрос исполняется в срок не более <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded text-xs">[30 календарных дней]</span>. По завершении заявителю направляется уведомление о выполнении анонимизации.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Контактные данные */}
      <section className="space-y-4 border-t border-[#E6DCD2] pt-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Settings className="w-5 h-5 text-[#8B6F5A]" />
          <h2>4. Контактные данные службы поддержки</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Для отслеживания статуса ранее поданной заявки или консультации по процедуре удаления данных:
        </p>
        <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E6DCD2] text-xs sm:text-sm space-y-1">
          <p><strong>Email по вопросам конфиденциальности:</strong> <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[privacy@ваш-домен.com]</span></p>
          <p><strong>Юридический адрес оператора:</strong> <span className="font-mono bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Юридический адрес организации]</span></p>
        </div>
      </section>
    </LegalPageShell>
  );
}
