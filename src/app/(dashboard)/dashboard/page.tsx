"use client";

import { authClient } from "@/lib/auth-client";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, Scissors, UserCog, Settings } from "lucide-react";
import Link from "next/link";

const quickLinks = [
  { title: "Клиенты", icon: Users, href: "/clients", color: "text-blue-500" },
  { title: "Услуги", icon: Scissors, href: "/services", color: "text-purple-500" },
  { title: "Мастера", icon: UserCog, href: "/masters", color: "text-orange-500" },
  { title: "Настройки", icon: Settings, href: "/settings/studio", color: "text-taupe" },
];

export default function DashboardPage() {
  const { data: session } = authClient.useSession();

  return (
    <DashboardShell>
      <div className="space-y-6 pb-20">
        <div>
          <h1 className="text-2xl font-bold text-taupe">Добро пожаловать, {session?.user.name}</h1>
          <p className="text-muted">Phase 2: управление студией активно</p>
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <Card className="bg-ivory border-borderSoft shadow-sm hover:shadow-md transition-shadow h-full">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium">{link.title}</CardTitle>
                    <Icon className={`w-4 h-4 ${link.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted">Открыть</div>
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
