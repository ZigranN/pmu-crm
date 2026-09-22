import { PageHeader } from "@/components/shared/page-header";
import { MasterForm } from "@/features/masters/components/master-form";
import { getMasterById } from "@/features/masters/server/queries";
import { getActiveServices } from "@/features/services/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect, notFound } from "next/navigation";

interface EditMasterPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMasterPage({ params }: EditMasterPageProps) {
  const { id } = await params;
  let context;
  try {
    context = await requireBrowserStudioPermission("MASTER_UPDATE");
  } catch {
    redirect("/dashboard");
  }

  let master;
  let services;
  try {
    master = await getMasterById(id, context.studioId);
    services = await getActiveServices(context.studioId);
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
