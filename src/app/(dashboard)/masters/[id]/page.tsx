import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { masters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Edit, Calendar } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default async function MasterDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const canRead = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_READ);
  if (!canRead) redirect("/dashboard");

  const master = await db.query.masters.findFirst({
    where: and(eq(masters.id, params.id), eq(masters.studioId, studioId)),
  });

  if (!master) notFound();

  const isArchived = !!master.deletedAt;

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/masters">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{master.displayName}</h1>
            <p className="text-sm text-textMuted">Профиль мастера</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isArchived && (
            <Badge variant="secondary">Архивирован</Badge>
          )}
          {!isArchived && master.isActive && (
            <Badge variant="default">Активен</Badge>
          )}
          {!isArchived && !master.isActive && (
            <Badge variant="secondary">Неактивен</Badge>
          )}
          <Link href={`/masters/${master.id}/schedule`}>
            <Button variant="outline">
              <Calendar className="mr-2 h-4 w-4" />
              Расписание
            </Button>
          </Link>
          <Link href={`/masters/${master.id}/edit`}>
            <Button>
              <Edit className="mr-2 h-4 w-4" />
              Редактировать
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Основная информация</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {master.photoUrl && (
            <div className="flex justify-center">
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
          <div>
            <label className="text-sm font-medium text-textMuted">Имя</label>
            <p className="text-base">{master.displayName}</p>
          </div>
          {master.phone && (
            <div>
              <label className="text-sm font-medium text-textMuted">Телефон</label>
              <p className="text-base">{master.phone}</p>
            </div>
          )}
          {master.email && (
            <div>
              <label className="text-sm font-medium text-textMuted">Email</label>
              <p className="text-base">{master.email}</p>
            </div>
          )}
          {master.bio && (
            <div>
              <label className="text-sm font-medium text-textMuted">О мастере</label>
              <p className="text-base">{master.bio}</p>
            </div>
          )}
          {master.calendarColor && (
            <div>
              <label className="text-sm font-medium text-textMuted">Цвет в календаре</label>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="w-8 h-8 rounded border"
                  style={{ backgroundColor: master.calendarColor }}
                />
                <span className="text-sm">{master.calendarColor}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
