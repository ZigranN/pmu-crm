"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertCircle,
  LogOut,
  ShieldCheck,
  Globe,
} from "lucide-react";
import { InstagramIcon } from "./instagram-icon";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getInstagramAuthUrlAction,
  disconnectInstagramAction,
} from "../server/actions";

export interface InstagramConnectionItem {
  id: string;
  studioId: string;
  userId: string;
  instagramAccountId: string;
  instagramUsername: string | null;
  instagramName: string | null;
  pageId: string | null;
  pageName: string | null;
  status: "connected" | "needs_reauth" | "error" | "disconnected";
  tokenExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InstagramSettingsProps {
  connections: InstagramConnectionItem[];
  isOwnerOrAdmin: boolean;
  studioInstagramHandle?: string | null;
}

export function InstagramSettings({
  connections,
  isOwnerOrAdmin,
  studioInstagramHandle,
}: InstagramSettingsProps) {
  const [isPending, startTransition] = useTransition();

  const handleConnect = () => {
    startTransition(async () => {
      try {
        const { authUrl } = await getInstagramAuthUrlAction();
        window.location.href = authUrl;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Не удалось запустить авторизацию Meta / Instagram";
        toast.error(message);
      }
    });
  };

  const handleDisconnect = (connectionId: string) => {
    if (!confirm("Вы уверены, что хотите отключить этот Instagram-аккаунт?")) {
      return;
    }

    startTransition(async () => {
      try {
        await disconnectInstagramAction(connectionId);
        toast.success("Instagram-аккаунт успешно отключен");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Ошибка при отключении";
        toast.error(message);
      }
    });
  };

  const activeConnections = connections.filter((c) => c.status === "connected");

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Подключено аккаунтов
              </p>
              <h3 className="text-2xl font-bold text-taupe">
                {activeConnections.length}
              </h3>
            </div>
            <InstagramIcon className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>

        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Канал Direct
              </p>
              <h3 className="text-2xl font-bold text-taupe">
                {activeConnections.length > 0 ? "Активен" : "Ожидает"}
              </h3>
            </div>
            {activeConnections.length > 0 ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-600/70" />
            ) : (
              <AlertCircle className="h-8 w-8 text-amber-600/70" />
            )}
          </CardContent>
        </Card>

        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Instagram Студии
              </p>
              <h3 className="text-lg font-bold text-taupe truncate max-w-[180px]">
                {studioInstagramHandle || "Не указан"}
              </h3>
            </div>
            <Globe className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>
      </div>

      {/* Main Connection Card */}
      <Card className="border-borderSoft">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <InstagramIcon className="h-5 w-5 text-taupe" />
                Meta Unified Login / Instagram Direct
              </CardTitle>
              <CardDescription className="mt-1">
                Подключение бизнес-аккаунта Instagram для приёма и отправки сообщений в CRM
              </CardDescription>
            </div>
            {isOwnerOrAdmin && (
              <Button
                onClick={handleConnect}
                disabled={isPending}
                className="bg-taupe text-white hover:bg-taupe/90"
              >
                <InstagramIcon className="h-4 w-4 mr-2" />
                {isPending ? "Перенаправление..." : "Подключить через Meta"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connections.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-lg bg-sand/10">
              <InstagramIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <h4 className="text-sm font-semibold text-taupe mb-1">
                Instagram не подключен
              </h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
                Авторизуйтесь через Meta, чтобы подключить Instagram Professional / Business аккаунт и отвечать клиентам прямо из диалогов.
              </p>
              {isOwnerOrAdmin && (
                <Button
                  onClick={handleConnect}
                  disabled={isPending}
                  variant="outline"
                  size="sm"
                >
                  Начать подключение
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => {
                const isConnected = conn.status === "connected";
                return (
                  <div
                    key={conn.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border border-borderSoft bg-ivory gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-taupe">
                          {conn.instagramUsername
                            ? `@${conn.instagramUsername.replace(/^@/, "")}`
                            : `Account ${conn.instagramAccountId}`}
                        </span>
                        <Badge
                          variant={isConnected ? "default" : "secondary"}
                          className={
                            isConnected
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none"
                              : ""
                          }
                        >
                          {isConnected ? "Подключен" : conn.status}
                        </Badge>
                      </div>

                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        {conn.instagramName && (
                          <span>Имя: {conn.instagramName}</span>
                        )}
                        {conn.pageName && (
                          <span>Страница: {conn.pageName}</span>
                        )}
                        <span>ID: {conn.instagramAccountId}</span>
                      </div>

                      {conn.lastError && (
                        <p className="text-xs text-destructive">
                          Ошибка: {conn.lastError}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {isOwnerOrAdmin && isConnected && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDisconnect(conn.id)}
                          disabled={isPending}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <LogOut className="h-4 w-4 mr-1" />
                          Отключить
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        <CardFooter className="bg-sand/10 border-t border-borderSoft px-6 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Токены зашифрованы по стандарту AES-256-GCM с изоляцией студии</span>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
