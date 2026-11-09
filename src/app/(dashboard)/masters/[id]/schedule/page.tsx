import { notFound, redirect } from "next/navigation";
import { getMasterById } from "@/features/masters/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { masterAvailability } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MasterScheduleForm } from "@/features/calendar/components/master-schedule-form";

export default async function MasterSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let context;
  try {
    context = await requireBrowserStudioPermission("MASTER_READ");
  } catch {
    redirect("/dashboard");
  }

  const master = await getMasterById(id, context.studioId);
  if (!master) notFound();

  const canEdit =
    (await hasPermission(db, context.userId, context.studioId, "MASTER_UPDATE")) ||
    (await hasPermission(db, context.userId, context.studioId, "STUDIO_MANAGE")) ||
    (master.userId === context.userId);

  const workingHoursRows = await db
    .select()
    .from(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, context.studioId),
        eq(masterAvailability.masterId, id)
      )
    );

  const initialWorkingHours = workingHoursRows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    isActive: r.isActive,
  }));

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/masters/${master.id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Расписание мастера</h1>
          <p className="text-sm text-textMuted">{master.displayName}</p>
        </div>
      </div>

      <MasterScheduleForm
        masterId={master.id}
        initialWorkingHours={initialWorkingHours}
        canEdit={canEdit}
      />
    </div>
  );
}
