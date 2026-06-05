import { PageHeader } from "@/components/shared/page-header";
import { ServiceForm } from "@/features/services/components/service-form";
import { getServiceById } from "@/features/services/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect, notFound } from "next/navigation";

interface EditServicePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditServicePage({ params }: EditServicePageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  let service;
  try {
    service = await getServiceById(id, studioId);
  } catch (error) {
    console.error("[Service Edit Page Error]", error);
    throw error;
  }
  
  if (!service) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Редактировать услугу"
        description={`Изменение параметров услуги: ${service.name}`}
        backHref="/services"
      />
      <ServiceForm initialData={service} />
    </div>
  );
}
