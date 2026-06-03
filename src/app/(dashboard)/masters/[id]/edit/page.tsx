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

  const master = await getMasterById(id, studioId);
  if (!master) notFound();

  const services = await getActiveServices(studioId);

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
