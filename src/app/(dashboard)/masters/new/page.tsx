import { PageHeader } from "@/components/shared/page-header";
import { MasterForm } from "@/features/masters/components/master-form";
import { getActiveServices } from "@/features/services/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect } from "next/navigation";

export default async function NewMasterPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const services = await getActiveServices(studioId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Новый мастер"
        description="Добавьте нового мастера в команду студии"
        backHref="/masters"
      />
      <MasterForm availableServices={services} />
    </div>
  );
}
