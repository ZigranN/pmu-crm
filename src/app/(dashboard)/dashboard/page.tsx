
import { requireBrowserStudioContext } from "@/server/auth/context";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  Scissors,
  UserCog,
  Settings,
  Calendar,
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  MessageSquare,
  ArrowRight,
  Zap,
  Activity,
  CheckCircle2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { getNeedsAttention } from "@/features/needs-attention/server/queries";
import { listHandoffs } from "@/features/handoffs/server/queries";
import { listConversations } from "@/features/conversations/server/queries";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";

export default async function DashboardPage() {
  const context = await requireBrowserStudioContext();
  const role = context.role;
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN";

  const [canReadAttention, canReadHandoffs, canReadConversations] = await Promise.all([
    hasPermission(db, context.userId, context.studioId, "CLIENT_READ").catch(() => false),
    hasPermission(db, context.userId, context.studioId, "HANDOFF_READ").catch(() => false),
    hasPermission(db, context.userId, context.studioId, "CONVERSATION_READ").catch(() => false),
  ]);

  const [attentionItems, handoffsList, conversationsList] = await Promise.all([
    canReadAttention ? getNeedsAttention().catch(() => []) : [],
    canReadHandoffs ? listHandoffs().catch(() => []) : [],
    canReadConversations ? listConversations(context.studioId).catch(() => []) : [],
  ]);

  const criticalItems = attentionItems.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const myPendingHandoffs = handoffsList.filter(
    (h) => h.status === "PENDING" && (h.toUserId === context.userId || isOwnerOrAdmin)
  );
  const unreadConversations = conversationsList.filter((c) => c.unreadCount > 0);

  const quickLinks = [
    { title: "Внимание", icon: AlertCircle, href: "/needs-attention", color: "text-amber-500", count: attentionItems.length },
    { title: "Диалоги", icon: MessageSquare, href: "/conversations", color: "text-blue-500", count: unreadConversations.length },
    { title: "Календарь", icon: Calendar, href: "/calendar", color: "text-emerald-500" },
    { title: "Клиенты", icon: Users, href: "/clients", color: "text-indigo-500" },
    { title: "Передачи", icon: ArrowRightLeft, href: "/handoffs", color: "text-teal-500", count: myPendingHandoffs.length },
    { title: "Услуги", icon: Scissors, href: "/services", color: "text-purple-500" },
    { title: "Мастера", icon: UserCog, href: "/masters", color: "text-orange-500" },
    ...(isOwnerOrAdmin
      ? [
          { title: "Автоматизации", icon: Zap, href: "/automations", color: "text-amber-600" },
          { title: "Операции", icon: Activity, href: "/operations", color: "text-rose-600" },
        ]
      : []),
    { title: "Настройки", icon: Settings, href: "/settings", color: "text-taupe" },
  ];

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title={`Добро пожаловать, ${context.userEmail || "Пользователь"}`}
        description="Оперативная сводка и управление процессами студии"
      >
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
            <Link href="/calendar">
              <Calendar className="w-3.5 h-3.5" />
              <span>Календарь</span>
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5 text-xs bg-taupe hover:bg-espresso text-ivory">
            <Link href="/clients/new">
              <Plus className="w-3.5 h-3.5" />
              <span>Новый клиент</span>
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Primary KPI & Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/needs-attention" className="block focus:outline-hidden focus:ring-2 focus:ring-ring rounded-lg">
          <Card className="hover:shadow-md transition-shadow bg-ivory border-borderSoft h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Внимание
              </CardTitle>
              <AlertCircle className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-taupe">{attentionItems.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {criticalItems.length > 0 ? (
                  <span className="text-amber-600 font-medium">
                    {criticalItems.length} срочных вопросов
                  </span>
                ) : (
                  "Нет критических вопросов"
                )}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/handoffs" className="block focus:outline-hidden focus:ring-2 focus:ring-ring rounded-lg">
          <Card className="hover:shadow-md transition-shadow bg-ivory border-borderSoft h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Передачи
              </CardTitle>
              <ArrowRightLeft className="w-4 h-4 text-teal-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-taupe">{myPendingHandoffs.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {myPendingHandoffs.length > 0
                  ? "Ожидают вашего ответа"
                  : "Очередь передач чиста"}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/conversations" className="block focus:outline-hidden focus:ring-2 focus:ring-ring rounded-lg">
          <Card className="hover:shadow-md transition-shadow bg-ivory border-borderSoft h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Диалоги
              </CardTitle>
              <MessageSquare className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-taupe">{unreadConversations.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {unreadConversations.length > 0
                  ? `${unreadConversations.length} непрочитанных диалогов`
                  : "Все сообщения прочитаны"}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card className="bg-ivory border-borderSoft">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Статус студии
            </CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold text-taupe truncate">
              {context.studioName || "Активная студия"}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-taupe/40 text-taupe">
                {role ?? "Нет роли"}
              </Badge>
              <span className="text-[10px] text-emerald-700 font-medium">Активна</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Attention Stream (if any) */}
      {criticalItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <CardTitle className="text-sm font-semibold text-amber-900">
                Срочные вопросы, требующие действия ({criticalItems.length})
              </CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs text-amber-900 hover:text-amber-950">
              <Link href="/needs-attention">
                Все вопросы <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {criticalItems.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="p-3 bg-white rounded-md border border-amber-200/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Badge
                      variant="outline"
                      className={
                        item.severity === "CRITICAL"
                          ? "bg-destructive/15 text-destructive border-destructive/30 text-[10px]"
                          : "bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]"
                      }
                    >
                      {item.severity === "CRITICAL" ? "Критично" : "Высокий"}
                    </Badge>
                    <span>{item.title}</span>
                  </div>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-7 text-xs self-end sm:self-center shrink-0">
                  <Link href={item.actionUrl}>
                    <span>{item.suggestedAction}</span>
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Navigation Links */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Быстрый переход
        </h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.title} href={link.href} className="group focus:outline-hidden focus:ring-2 focus:ring-ring rounded-lg">
                <Card className="bg-ivory border-borderSoft shadow-2xs hover:shadow-sm transition-all h-full group-hover:border-taupe/40">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium group-hover:text-taupe transition-colors">
                      {link.title}
                    </CardTitle>
                    <Icon className={`w-4 h-4 ${link.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground flex items-center justify-between">
                      <span>Открыть раздел</span>
                      {typeof link.count === "number" && link.count > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {link.count}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
