import { requireBrowserStudioContext } from "@/server/auth/context";
import { getStudioById } from "@/features/studios/server/queries";
import { PageHeader } from "@/components/shared/page-header";
import { StudioSettingsForm } from "@/features/settings/components/studio-settings-form";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";

export default async function StudioSettingsPage() {
  const context = await requireBrowserStudioContext();
  const studioId = context.studioId;

  const [studio, canUpdate] = await Promise.all([
    getStudioById(studioId),
    hasPermission(db, context.userId, studioId, "SETTINGS_UPDATE")
  ]).catch((error) => {
    console.error("[Studio Settings Page Error]", error);
    throw error;
  });
  
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
