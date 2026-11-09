import { requireBrowserStudioContext } from "@/server/auth/context";
import {
  getGoogleCalendarConnections,
  getGoogleCalendarStats,
  getGoogleCalendarEventMappings,
} from "@/features/google-calendar/server/queries";
import { GoogleCalendarSettings } from "@/features/google-calendar/components/google-calendar-settings";

export default async function GoogleCalendarSettingsPage() {
  const context = await requireBrowserStudioContext();
  const isOwnerOrAdmin = context.role === "OWNER" || context.role === "ADMIN" || context.role === "SUPER_ADMIN" || context.role === "STUDIO_ADMIN";

  const [connections, stats, mappings] = await Promise.all([
    getGoogleCalendarConnections(),
    getGoogleCalendarStats(),
    getGoogleCalendarEventMappings(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-taupe">Google Календарь</h1>
        <p className="text-muted-foreground text-sm">
          Управление интеграцией с Google Calendar и синхронизацией расписания
        </p>
      </div>

      <GoogleCalendarSettings
        connections={connections}
        stats={stats}
        mappings={mappings}
        currentUserId={context.userId}
        isOwnerOrAdmin={isOwnerOrAdmin}
      />
    </div>
  );
}
