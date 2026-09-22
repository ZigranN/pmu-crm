import { PageHeader } from "@/components/shared/page-header";
import { ServiceForm } from "@/features/services/components/service-form";
import { getServiceById, getCatalogOptions, getServices } from "@/features/services/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect, notFound } from "next/navigation";
import { LegacyServiceCleanup } from "@/features/services/components/catalog-tools";

interface EditServicePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditServicePage({ params }: EditServicePageProps) {
  const { id } = await params;
  let context;
  try {
    context = await requireBrowserStudioPermission("SERVICE_UPDATE");
  } catch {
    redirect(`/services/${id}`);
  }
  const studioId = context.studioId;

  let service;
  try {
    service = await getServiceById(id, studioId);
  } catch (error) {
    console.error("[Service Edit Page Error]", error);
    throw error;
  }
  
  if (!service) notFound();
  const options = await getCatalogOptions(studioId);
  const owner = context.role === "OWNER";
  const legacy = owner && service.catalogVersion === 1 ? (await getServices(studioId, { showArchived: true })).filter(row => row.catalogVersion === 0 && !row.supersededById) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Редактировать услугу"
        description={`Изменение параметров услуги: ${service.name}`}
        backHref="/services"
      />
      <ServiceForm initialData={service} {...options} />
      {owner && service.catalogVersion === 1 && !service.deletedAt && <LegacyServiceCleanup canonicalId={service.id} rows={legacy} />}
    </div>
  );
}
