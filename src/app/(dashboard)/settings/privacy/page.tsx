import { requireBrowserStudioPermission } from "@/server/auth/context";
import { PageHeader } from "@/components/shared/page-header";
import { PrivacyDashboard } from "@/features/privacy/components/privacy-dashboard";
import { getPrivacyRequests, getStudioRetentionPolicy } from "@/features/privacy/server/queries";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";

export default async function PrivacySettingsPage() {
  const context = await requireBrowserStudioPermission("PRIVACY_READ");

  const [canManage, canExport] = await Promise.all([
    hasPermission(db, context.userId, context.studioId, "PRIVACY_MANAGE"),
    hasPermission(db, context.userId, context.studioId, "PRIVACY_EXPORT"),
  ]);

  const [requests, retentionPolicy] = await Promise.all([
    getPrivacyRequests(context.studioId),
    getStudioRetentionPolicy(context.studioId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Конфиденциальность и жизненный цикл данных"
        description="Управление запросами субъектов данных (DSAR), экспорт, анонимизация и политики хранения"
      />
      <PrivacyDashboard
        requests={requests}
        retentionPolicy={retentionPolicy}
        canManage={canManage}
        canExport={canExport}
        isOwner={context.role === "OWNER"}
      />
    </div>
  );
}
