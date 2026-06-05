import { PageHeader } from "@/components/shared/page-header";
import { MasterForm } from "@/features/masters/components/master-form";
import { getMasterById } from "@/features/masters/server/queries";
import { getActiveServices } from "@/features/services/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect, notFound } from "next/navigation";

interface EditMasterPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMasterPage({ params }: EditMasterPageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  let master;
  let services;
  try {
    master = await getMasterById(id, studioId);
    services = await getActiveServices(studioId);
  } catch (error) {
    console.error("[Master Edit Page Error]", error);
    throw error;
  }
  
  if (!master) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Редактировать мастера"
        description={`Изменение данных: ${master.displayName}`}
        backHref="/masters"
      />
      <MasterForm initialData={master} availableServices={services} />
    </div>
  );
}
