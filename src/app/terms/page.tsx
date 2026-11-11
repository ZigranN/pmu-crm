import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { FileText, UserCheck, ShieldAlert, Sliders, Scale, LifeBuoy } from "lucide-react";

export const metadata: Metadata = {
  title: "Условия использования | PMU CRM",
  description: "Условия использования платформы PMU CRM, правила доступа, права и обязанности сторон при использовании CRM и интеграций с Instagram Direct.",
  openGraph: {
    title: "Условия использования | PMU CRM",
    description: "Условия использования платформы PMU CRM, правила доступа, права и обязанности сторон при использовании CRM и интеграций с Instagram Direct.",
  },
};

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Условия использования"
      subtitle="Настоящие Условия использования регулируют порядок предоставления и использования сервиса PMU CRM, включая встроенные модули записи, аналитики и коммуникаций через Meta Platforms (Instagram Direct)."
      activePath="/terms"
    >
      {/* 1. Предмет соглашения */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <FileText className="w-5 h-5 text-[#8B6F5A]" />
          <h2>1. Предмет соглашения и принятие условий</h2>
        </div>
        <p>
          Настоящее Пользовательское соглашение (далее — «Условия») представляет собой юридически обязывающий договор между оператором сервиса <strong>PMU CRM</strong> (далее — «Исполнитель», «Сервис») и физическим или юридическим лицом (далее — «Пользователь», «Студия»), использующим программное обеспечение PMU CRM.
        </p>
        <div className="bg-[#FAF7F2] border border-[#E6DCD2] rounded-xl p-4 text-xs sm:text-sm space-y-2 font-mono">
          <div><strong>Исполнитель / Администратор платформы:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Полное наименование организации / ИП]</span></div>
          <div><strong>ОГРН / ОГРНИП / ИНН:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[ОГРН / ИНН]</span></div>
          <div><strong>Юридический адрес:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[Юридический адрес]</span></div>
          <div><strong>Email службы поддержки:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded">[support@ваш-домен.com]</span></div>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Регистрация в Сервисе, авторизация или фактическое начало использования функций CRM означает безоговорочное согласие Пользователя со всеми положениями настоящих Условий и нашей <a href="/privacy" className="text-[#8B6F5A] underline">Политики конфиденциальности</a>.
        </p>
      </section>

      {/* 2. Учетные записи и роли */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <UserCheck className="w-5 h-5 text-[#8B6F5A]" />
          <h2>2. Учетные записи, роли и безопасность</h2>
        </div>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-2">
          <li><strong>Создание учетной записи:</strong> Доступ к CRM предоставляется зарегистрированным пользователям (владельцам студий, администраторам, мастерам). Пользователь гарантирует достоверность предоставленных при регистрации сведений.</li>
          <li><strong>Конфиденциальность учетных данных:</strong> Пользователь несет единоличную ответственность за сохранность логина и пароля, а также за любые действия, совершенные под его учетной записью.</li>
          <li><strong>Разграничение прав доступа (RBAC):</strong> Система обеспечивает разграничение полномочий в зависимости от назначенной роли в студии (OWNER, ADMIN, MASTER). Пользователь обязуется не предпринимать попыток несанкционированного повышения привилегий.</li>
        </ul>
      </section>

      {/* 3. Интеграция с Meta и мессенджерами */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Sliders className="w-5 h-5 text-[#8B6F5A]" />
          <h2>3. Использование интеграции с Meta (Instagram Direct) и сторонними API</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          При использовании функций обмена сообщениями и синхронизации с Instagram Direct Пользователь признает и гарантирует:
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-2">
          <li><strong>Соблюдение правил Meta:</strong> Пользователь обязуется строго соблюдать <em>Meta Platform Terms</em>, <em>Developer Policies</em> и <em>Правила сообщества Instagram</em>.</li>
          <li><strong>Запрет спама:</strong> Категорически запрещается использование интеграции для массовых несогласованных рекламных рассылок (спама), рассылки запрещенных материалов или ввода клиентов в заблуждение.</li>
          <li><strong>Права на подключенные страницы:</strong> Пользователь гарантирует, что обладает всеми необходимыми правами и полномочиями на управление подключаемым бизнес-аккаунтом Instagram/Facebook.</li>
          <li><strong>Автономия платформ:</strong> Сервис не несет ответственности за перерывы в работе или изменения политик со стороны Meta Platforms, Inc. или других сторонних провайдеров API.</li>
        </ul>
      </section>

      {/* 4. Права на данные и конфиденциальность */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <ShieldAlert className="w-5 h-5 text-[#8B6F5A]" />
          <h2>4. Обработка персональных данных и права сторон</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          В отношениях между Сервисом и Студией:
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
          <li><strong>Студия</strong> выступает <em>Оператором персональных данных</em> в отношении данных своих клиентов и обязуется самостоятельно получать надлежащие согласия клиентов на обработку персональных данных и проведение процедур.</li>
          <li><strong>Сервис PMU CRM</strong> выступает <em>Обработчиком данных (техническим провайдером)</em>, обеспечивающим хранение, систематизацию и интерфейсы доступа в соответствии с указаниями Студии.</li>
          <li>Сервис предоставляет встроенные инструменты для удовлетворения запросов субъектов данных на экспорт и анонимизацию (DSAR).</li>
        </ul>
      </section>

      {/* 5. Тарифы и оплата */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <Scale className="w-5 h-5 text-[#8B6F5A]" />
          <h2>5. Тарифы, оплата и условия обслуживания</h2>
        </div>
        <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E6DCD2] text-xs sm:text-sm space-y-2">
          <p>
            <strong>Порядок тарификации:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded font-mono">[Указать модель подписки / тарифные планы / условия бесплатного пробного периода]</span>.
          </p>
          <p>
            <strong>Порядок расчетов и возвратов:</strong> <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded font-mono">[Условия выставления счетов, списания регулярных платежей и возврата денежных средств]</span>.
          </p>
        </div>
      </section>

      {/* 6. Ограничение ответственности */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold text-[#2B211B]">
          <LifeBuoy className="w-5 h-5 text-[#8B6F5A]" />
          <h2>6. Ограничение ответственности и гарантии</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Сервис предоставляется по принципу <em>«как есть» (as is)</em>. Исполнитель не гарантирует бесперебойную и безошибочную работу сторонних телекоммуникационных сетей, сервисов Meta или провайдеров мессенджеров.
        </p>
        <ul className="list-disc list-inside text-xs sm:text-sm text-[#7A6A5F] space-y-1">
          <li>Исполнитель не несет ответственности за косвенные убытки, упущенную выгоду или потерю данных Пользователя, возникшие вследствие форс-мажорных обстоятельств или действий третьих лиц.</li>
          <li><span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded font-mono">[Ограничение совокупной ответственности Исполнителя суммой фактически внесенных за последний расчетный период платежей]</span>.</li>
        </ul>
      </section>

      {/* 7. Изменение условий и применимое право */}
      <section className="space-y-4 border-t border-[#E6DCD2] pt-6">
        <h2 className="text-lg font-semibold text-[#2B211B]">7. Применимое право и разрешение споров</h2>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          К настоящим Условиям и отношениям сторон применяется материальное и процессуальное право: <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded font-mono">[Указать применимое законодательство / юрисдикцию, например: законодательство страны регистрации оператора]</span>.
        </p>
        <p className="text-xs sm:text-sm text-[#7A6A5F]">
          Все споры решаются путем обязательного направления письменной претензии на адрес <span className="bg-amber-100 text-amber-950 px-1 py-0.5 rounded font-mono">[support@ваш-домен.com]</span>. Срок ответа на претензию — 30 дней.
        </p>
      </section>
    </LegalPageShell>
  );
}
