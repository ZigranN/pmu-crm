import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { masters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft, Calendar } from "lucide-react";
import Link from "next/link";

export default async function MasterSchedulePage({
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Управление расписанием
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-taupe/10 flex items-center justify-center">
                <Calendar className="h-8 w-8 text-taupe" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">
                Расписание мастера будет доступно в Phase 3
              </h3>
              <p className="text-sm text-textMuted max-w-md mx-auto">
                Функционал управления расписанием, рабочими часами, перерывами и
                выходными будет реализован в следующей фазе разработки вместе с
                Calendar Engine и системой записей.
              </p>
            </div>
            <div className="pt-4">
              <Link href={`/masters/${master.id}`}>
                <Button variant="outline">
                  Вернуться к профилю мастера
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
