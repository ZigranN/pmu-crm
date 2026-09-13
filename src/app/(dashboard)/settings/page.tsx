
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { getStudioRole } from "@/lib/roles";
import { db } from "@/db";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronRight, Settings, Users, Scissors } from "lucide-react";
import Link from "next/link";

export default async function SettingsPage() {
  const session = await getSession();
  const studioId = session ? await getCurrentStudioId(session.user.id) : undefined;
  const role = session && studioId ? await getStudioRole(db, session.user.id, studioId) : null;

  const settingsLinks = [
    ...(role === "OWNER" ? [{ title: "Разбор старых записей", description: "Записи без привязки к циклу процедуры", icon: Settings, href: "/settings/cycle-migration" }] : []),
    ...(role === "OWNER" ? [{ title: "Обработка событий", description: "Ошибки, повторные попытки и восстановление", icon: Settings, href: "/settings/jobs" }] : []),
    ...(role === "OWNER" ? [{ title: "История изменений и доступа", description: "Аудит действий и чтения данных", icon: Settings, href: "/settings/audit" }] : []),
    { title: "Участники и роли", description: "Доступ к студии и привязка мастеров", icon: Users, href: "/settings/team" },
    {
      title: "Студия",
      description: "Название, адрес, контакты",
      icon: Settings,
      href: "/settings/studio",
    },
    {
      title: "Услуги",
      description: "Управление прайс-листом",
      icon: Scissors,
      href: "/services",
    },
    {
      title: "Мастера",
      description: "Команда и график работы",
      icon: Users,
      href: "/masters",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-taupe">Настройки</h1>
        <p className="text-muted">Управление студией и профилем</p>
      </div>

      <div className="grid gap-4">
        {settingsLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="hover:bg-sand/50 transition-colors">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sand text-taupe">
                    <link.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">{link.title}</h3>
                    <p className="text-xs text-muted-foreground">{link.description}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="bg-ivory border-borderSoft">
        <CardHeader>
          <CardTitle>Информация о пользователе</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Имя</span>
            <span className="font-medium">{session?.user.name}</span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{session?.user.email}</span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Текущая роль</span>
            <Badge variant="outline" className="text-taupe border-taupe">
              {role ?? "Нет роли в студии"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
