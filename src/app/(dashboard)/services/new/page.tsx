import { PageHeader } from "@/components/shared/page-header";
import { ServiceForm } from "@/features/services/components/service-form";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { getCatalogOptions } from "@/features/services/server/queries";

export default async function NewServicePage() {
  const { studioId } = await requireBrowserStudioPermission("SERVICE_CREATE");
  const options = await getCatalogOptions(studioId);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Новая услуга"
        description="Добавьте новую услугу в прейскурант студии"
        backHref="/services"
      />
      <ServiceForm {...options} />
    </div>
  );
}
