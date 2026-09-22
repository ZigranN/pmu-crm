import { PageHeader } from "@/components/shared/page-header";
import { MasterForm } from "@/features/masters/components/master-form";
import { getActiveServices } from "@/features/services/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

export default async function NewMasterPage() {
  let context;
  try {
    context = await requireBrowserStudioPermission("MASTER_CREATE");
  } catch {
    redirect("/dashboard");
  }

  const services = await getActiveServices(context.studioId)
    .catch((error) => {
      console.error("[Master New Page Error]", error);
      throw error;
    });

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
