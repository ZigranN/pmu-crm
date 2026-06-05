import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { masters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit, Calendar } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { PageHeader } from "@/components/shared/page-header";

export default async function MasterDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const canRead = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_READ);
  if (!canRead) redirect("/dashboard");

  let master;
  try {
    master = await db.query.masters.findFirst({
      where: and(eq(masters.id, id), eq(masters.studioId, studioId)),
    });
  } catch (error) {
    console.error("[Master Detail Page Error]", error);
    throw error;
  }

  if (!master) notFound();

  const isArchived = !!master.deletedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        title={master.displayName}
        description="Профиль мастера"
        backHref="/masters"
      >
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="hidden sm:flex">
            <Link href={`/masters/${master.id}/schedule`}>
              <Calendar className="mr-2 h-4 w-4" />
              Расписание
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/masters/${master.id}/edit`}>
              <Edit className="mr-2 h-4 w-4" />
              Редактировать
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-6">
        <div className="flex sm:hidden justify-center gap-2 mb-2">
           <Button asChild variant="outline" size="sm" className="flex-1">
            <Link href={`/masters/${master.id}/schedule`}>
              <Calendar className="mr-2 h-4 w-4" />
              Расписание
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Основная информация</CardTitle>
            <div className="flex items-center gap-2">
              {isArchived && (
                <Badge variant="secondary">Архивирован</Badge>
              )}
              {!isArchived && master.isActive && (
                <Badge variant="default" className="bg-success text-ivory">Активен</Badge>
              )}
              {!isArchived && !master.isActive && (
                <Badge variant="secondary">Неактивен</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {master.photoUrl && (
              <div className="flex justify-center pb-4">
                <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-borderSoft">
                  <Image
                    src={master.photoUrl}
                    alt={master.displayName}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Имя</label>
                <p className="text-base font-medium">{master.displayName}</p>
              </div>
              {master.phone && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Телефон</label>
                  <p className="text-base font-medium">{master.phone}</p>
                </div>
              )}
              {master.email && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
                  <p className="text-base font-medium">{master.email}</p>
                </div>
              )}
              {master.calendarColor && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Цвет в календаре</label>
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-6 h-6 rounded border"
                      style={{ backgroundColor: master.calendarColor }}
                    />
                    <span className="text-sm font-medium">{master.calendarColor}</span>
                  </div>
                </div>
              )}
            </div>
            {master.bio && (
              <div className="pt-2 border-t border-borderSoft">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">О мастере</label>
                <p className="text-base mt-1 italic text-espresso">{master.bio}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
