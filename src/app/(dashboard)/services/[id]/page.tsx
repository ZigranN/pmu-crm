import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { services } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Edit } from "lucide-react";
import Link from "next/link";

export default async function ServiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const canRead = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SERVICE_READ);
  if (!canRead) redirect("/dashboard");

  const service = await db.query.services.findFirst({
    where: and(eq(services.id, params.id), eq(services.studioId, studioId)),
  });

  if (!service) notFound();

  const isArchived = !!service.deletedAt;
  const price = service.priceCents ? (service.priceCents / 100).toFixed(2) : "0.00";

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/services">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{service.name}</h1>
            <p className="text-sm text-textMuted">Детали услуги</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isArchived && (
            <Badge variant="secondary">Архивирована</Badge>
          )}
          {!isArchived && service.isActive && (
            <Badge variant="default">Активна</Badge>
          )}
          {!isArchived && !service.isActive && (
            <Badge variant="secondary">Неактивна</Badge>
          )}
          <Link href={`/services/${service.id}/edit`}>
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
          <div>
            <label className="text-sm font-medium text-textMuted">Название</label>
            <p className="text-base">{service.name}</p>
          </div>
          {service.description && (
            <div>
              <label className="text-sm font-medium text-textMuted">Описание</label>
              <p className="text-base">{service.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-textMuted">Категория</label>
              <p className="text-base">{service.category}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-textMuted">Тип процедуры</label>
              <p className="text-base">{service.procedureType}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Стоимость и время</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-textMuted">Стоимость</label>
              <p className="text-base">€{price}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-textMuted">Длительность</label>
              <p className="text-base">{service.durationMinutes} минут</p>
            </div>
            <div>
              <label className="text-sm font-medium text-textMuted">Буфер до</label>
              <p className="text-base">{service.bufferBeforeMinutes} минут</p>
            </div>
            <div>
              <label className="text-sm font-medium text-textMuted">Буфер после</label>
              <p className="text-base">{service.bufferAfterMinutes} минут</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дополнительно</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-textMuted">Требуется коррекция</label>
            <p className="text-base">{service.requiresCorrection ? "Да" : "Нет"}</p>
          </div>
          {service.requiresCorrection && service.correctionAfterDays && (
            <div>
              <label className="text-sm font-medium text-textMuted">Коррекция через</label>
              <p className="text-base">{service.correctionAfterDays} дней</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
