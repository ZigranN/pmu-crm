"use client";

import { authClient } from "@/lib/auth-client";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, Scissors, UserCog, Settings, Calendar } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";

const quickLinks = [
  { title: "Клиенты", icon: Users, href: "/clients", color: "text-blue-500" },
  { title: "Услуги", icon: Scissors, href: "/services", color: "text-purple-500" },
  { title: "Мастера", icon: UserCog, href: "/masters", color: "text-orange-500" },
  { title: "Настройки", icon: Settings, href: "/settings/studio", color: "text-taupe" },
  { title: "Календарь", icon: Calendar, href: "#", color: "text-muted-foreground", badge: "Скоро" },
];

export default function DashboardPage() {
  const { data: session } = authClient.useSession();

  return (
    <DashboardShell>
      <div className="space-y-6 pb-20">
        <PageHeader 
          title={`Добро пожаловать, ${session?.user.name || "Гость"}`}
          description="Управление вашей студией в одном месте"
        />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.title} href={link.href} className={link.badge ? "pointer-events-none opacity-70" : ""}>
                <Card className="bg-ivory border-borderSoft shadow-sm hover:shadow-md transition-shadow h-full relative overflow-hidden">
                  {link.badge && (
                    <div className="absolute top-0 right-0 bg-taupe text-ivory text-[10px] px-2 py-0.5 rounded-bl-lg font-bold">
                      {link.badge}
                    </div>
                  )}
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium">{link.title}</CardTitle>
                    <Icon className={`w-4 h-4 ${link.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      {link.badge ? "В разработке" : "Открыть раздел"}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="bg-ivory border-borderSoft shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Текущая роль</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-taupe">  {(session?.user as any)?.role ?? "No role"}
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-ivory border-borderSoft shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Статус системы</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">Активна</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
