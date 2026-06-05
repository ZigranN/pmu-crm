import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { getStudioById } from "@/features/studios/server/queries";
import { PageHeader } from "@/components/shared/page-header";
import { StudioSettingsForm } from "@/features/settings/components/studio-settings-form";
import { redirect, notFound } from "next/navigation";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { db } from "@/db";

export default async function StudioSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const data = await Promise.all([
    getStudioById(studioId),
    hasPermission(db, session.user.id, studioId, PERMISSIONS.SETTINGS_UPDATE)
  ]).catch((error) => {
    console.error("[Studio Settings Page Error]", error);
    throw error;
  });
  
  const studio = data[0];
  const canUpdate = data[1];
  
  if (!studio) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки студии"
        description="Управление информацией и контактами вашей студии"
        backHref="/settings"
      />
      <StudioSettingsForm initialData={studio} readonly={!canUpdate} />
    </div>
  );
}
