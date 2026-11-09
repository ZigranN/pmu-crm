import { redirect } from "next/navigation";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { masters, studios } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getStudioCalendarView } from "@/features/calendar/server/availability";
import { CalendarView } from "@/features/calendar/components/calendar-view";
import { getWeekDates, normalizeTimezone } from "@/features/calendar/domain/timezone";

export default async function CalendarPage() {
  let context;
  try {
    context = await requireBrowserStudioContext();
  } catch {
    redirect("/login");
  }

  const canRead =
    (await hasPermission(db, context.userId, context.studioId, "APPOINTMENT_READ")) ||
    (await hasPermission(db, context.userId, context.studioId, "MASTER_READ"));

  if (!canRead) {
    redirect("/dashboard");
  }

  const canManage =
    (await hasPermission(db, context.userId, context.studioId, "STUDIO_MANAGE")) ||
    (await hasPermission(db, context.userId, context.studioId, "MASTER_UPDATE"));

  const [studio] = await db
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, context.studioId));

  const timezone = normalizeTimezone(studio?.timezone);
  const todayStr = new Date().toISOString().slice(0, 10);
  const week = getWeekDates(todayStr, timezone);

  // Initial week calendar view model
  const initialViewModel = await getStudioCalendarView(context, {
    startDate: week.startDate,
    endDate: week.endDate,
    durationMinutes: 60,
  });

  // Active masters list for filters
  const activeMasters = await db
    .select({
      id: masters.id,
      displayName: masters.displayName,
    })
    .from(masters)
    .where(
      and(
        eq(masters.studioId, context.studioId),
        eq(masters.isActive, true),
        isNull(masters.deletedAt)
      )
    );

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Календарь и доступность</h1>
          <p className="text-sm text-textMuted">
            Расписание мастеров, занятые интервалы и доступные окна для записи
          </p>
        </div>
      </div>

      <CalendarView
        initialViewModel={initialViewModel}
        allMasters={activeMasters}
        canManage={canManage}
      />
    </div>
  );
}
