"use client";

import { authClient } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronRight, Settings, Users, Scissors } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  const { data: session } = authClient.useSession();

  const settingsLinks = [
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
              {(session?.user as any).role}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
