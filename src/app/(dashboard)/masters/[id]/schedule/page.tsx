import { notFound, redirect } from "next/navigation";
import { getMasterById } from "@/features/masters/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft, Calendar } from "lucide-react";
import Link from "next/link";

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
