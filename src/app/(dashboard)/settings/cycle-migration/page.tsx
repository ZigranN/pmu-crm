import { getLegacyCycleReport } from "@/features/treatment-cycles/server/queries";
import { PageHeader } from "@/components/shared/page-header";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

const labels: Record<string, string> = {
  manual_course_grouping_required: "Требуется определить курс лечения вручную",
  inconsistent_tenant: "Несогласованные связи студии",
  merged_client_reference: "Ссылка на объединённую карточку",
  catalog_mapping_required: "Услуга не сопоставлена с каталогом",
  zone_selection_required: "Требуется выбрать зону",
  inconsistent_appointment_link: "Процедура связана с визитом другого клиента или студии",
  ambiguous_procedure_zone: "Зона процедуры неоднозначна",
};

export default async function LegacyCycleReportPage() {
  try {
    await requireBrowserStudioPermission("STUDIO_MANAGE");
  } catch {
    redirect("/dashboard");
  }
  const report = await getLegacyCycleReport();
  return (
    <div className="space-y-4">
      <PageHeader title="Старые записи: проверка циклов" backHref="/settings" />
      <p>Отчёт только для проверки. Циклы не создаются, старые статусы, оплаты и визиты не изменяются.</p>
      {report.truncated && <p role="alert">Показаны первые 1000 записей каждого типа. Перед переносом требуется полный разбор оставшихся данных.</p>}
      {!report.entries.length && <p>Несопоставленных записей не найдено.</p>}
      <ul className="space-y-3">
        {report.entries.map((row) => (
          <li key={`${row.kind}:${row.id}`} className="rounded border p-3 break-words">
            <p>{row.kind === "appointment" ? "Визит" : "Процедура"}: {row.id}</p>
            <p>Клиент: {row.clientId}</p>
            <ul>{row.reasons.map((reason) => <li key={reason}>{labels[reason]}</li>)}</ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
