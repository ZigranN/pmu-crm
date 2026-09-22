import { getServicePricing } from "@/features/offers/server/queries";
import { MasterPriceForm } from "@/features/offers/components/master-pricing";
import { PageHeader } from "@/components/shared/page-header";
import { notFound } from "next/navigation";
import { requireBrowserStudioPermission } from "@/server/auth/context";

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireBrowserStudioPermission("SERVICE_UPDATE");
  const { id } = await params;
  const options = await getServicePricing(id);
  if (!options.length) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="Цены мастеров" description={options[0].serviceName} backHref={`/services/${id}/edit`} />
      <p>Цена мастера заменяет базовую для новых расчётов. Ранее согласованные предложения и цены визитов сохраняются.</p>
      {options.length === 1 && <p>Нет активных мастеров, которым назначена эта услуга. Назначьте её в профиле мастера.</p>}
      {options.filter(row => row.masterId).map(row => <MasterPriceForm key={`${row.masterId}:${row.version}`} option={row} />)}
    </div>
  );
}
