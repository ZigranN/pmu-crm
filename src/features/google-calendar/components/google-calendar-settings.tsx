"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  GoogleCalendarConnectionView,
  GoogleCalendarStatsSummary,
  GoogleCalendarEventMappingView,
} from "../server/queries";
import {
  getGoogleAuthUrlAction,
  disconnectGoogleCalendarAction,
  triggerManualSyncAction,
  updateSyncDirectionAction,
} from "../server/actions";

interface GoogleCalendarSettingsProps {
  connections: GoogleCalendarConnectionView[];
  stats: GoogleCalendarStatsSummary;
  mappings: GoogleCalendarEventMappingView[];
  currentUserId: string;
  isOwnerOrAdmin: boolean;
}

export function GoogleCalendarSettings({
  connections,
  stats,
  mappings,
  currentUserId,
  isOwnerOrAdmin,
}: GoogleCalendarSettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleConnect = async (masterId?: string) => {
    startTransition(async () => {
      try {
        const { authUrl } = await getGoogleAuthUrlAction({ masterId });
        window.location.href = authUrl;
      } catch (err: any) {
        toast.error(err.message || "Не удалось запустить авторизацию Google");
      }
    });
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm("Вы уверены, что хотите отключить Google Календарь?")) return;

    startTransition(async () => {
      try {
        await disconnectGoogleCalendarAction(connectionId);
        toast.success("Google Календарь успешно отключен");
      } catch (err: any) {
        toast.error(err.message || "Ошибка при отключении");
      }
    });
  };

  const handleManualSync = async (connectionId: string) => {
    setSyncingId(connectionId);
    try {
      const { result } = await triggerManualSyncAction(connectionId);
      toast.success(
        `Синхронизация завершена. Проверено: ${result.totalEvaluated}, перенесено: ${result.rescheduledCount}, отменено: ${result.cancelledCount}`
      );
    } catch (err: any) {
      toast.error(err.message || "Ошибка синхронизации");
    } finally {
      setSyncingId(null);
    }
  };

  const handleDirectionChange = async (
    connectionId: string,
    direction: "two_way" | "outbound_only"
  ) => {
    startTransition(async () => {
      try {
        await updateSyncDirectionAction(connectionId, direction);
        toast.success("Режим синхронизации обновлен");
      } catch (err: any) {
        toast.error(err.message || "Ошибка при смене режима");
      }
    });
  };

  const activeConnections = connections.filter((c) => c.status === "connected");

  return (
    <div className="space-y-6">
      {/* Top Banner / Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Подключено</p>
              <h3 className="text-2xl font-bold text-taupe">{stats.activeConnections}</h3>
            </div>
            <Calendar className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>

        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Синхронизировано</p>
              <h3 className="text-2xl font-bold text-taupe">{stats.totalSyncedEvents}</h3>
            </div>
            <CheckCircle2 className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>

        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Ошибки sync</p>
              <h3 className="text-2xl font-bold text-taupe">{stats.errorConnections}</h3>
            </div>
            <AlertCircle className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>

        <Card className="bg-sand/30 border-borderSoft">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">Последний sync</p>
              <h3 className="text-sm font-semibold text-taupe">
                {stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleTimeString("ru-RU") : "—"}
              </h3>
            </div>
            <Clock className="h-8 w-8 text-taupe/40" />
          </CardContent>
        </Card>
      </div>

      {/* Main Connection Action */}
      <Card className="border-borderSoft">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Интеграция с Google Календарем</CardTitle>
              <CardDescription>
                Автоматическая синхронизация визитов CRM с календарями мастеров
              </CardDescription>
            </div>
            <Button
              onClick={() => handleConnect()}
              disabled={isPending}
              className="bg-taupe hover:bg-taupe/90 text-ivory gap-2"
            >
              <Calendar className="h-4 w-4" />
              Подключить Google Календарь
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-sand/20 border border-sand rounded-lg p-4 flex gap-3 items-start text-xs text-taupe">
            <ShieldCheck className="h-5 w-5 text-taupe shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Принцип авторитетности CRM</p>
              <p className="text-muted-foreground leading-relaxed">
                CRM остается единственным источником правды для клиентов, циклов процедур, согласий и
                медицинских статусов. Google Календарь служит зеркалом для отображения расписания мастерам.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connections List */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-taupe">Активные подключения</h3>
        {activeConnections.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground border-dashed">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-taupe">Нет подключенных аккаунтов Google</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Подключите аккаунт Google для автоматической синхронизации расписания
            </p>
            <Button variant="outline" onClick={() => handleConnect()} disabled={isPending}>
              Подключить аккаунт
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeConnections.map((conn) => {
              const isSyncing = syncingId === conn.id;
              const canEdit = isOwnerOrAdmin || conn.userId === currentUserId;

              return (
                <Card key={conn.id} className="border-borderSoft flex flex-col justify-between">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-sand/60 flex items-center justify-center font-bold text-taupe">
                          G
                        </div>
                        <div>
                          <CardTitle className="text-base font-semibold">
                            {conn.googleEmail || "Google Account"}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {conn.masterName ? `Мастер: ${conn.masterName}` : `Пользователь: ${conn.userName ?? conn.userEmail}`}
                          </p>
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className={
                          conn.status === "connected"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        {conn.status === "connected" ? "Подключен" : conn.status}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-borderSoft/50">
                      <span className="text-muted-foreground">Календарь:</span>
                      <span className="font-medium">{conn.calendarSummary || conn.calendarId}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-borderSoft/50">
                      <span className="text-muted-foreground">Режим:</span>
                      <div className="flex items-center gap-2">
                        <select
                          disabled={!canEdit || isPending}
                          value={conn.syncDirection}
                          onChange={(e) =>
                            handleDirectionChange(
                              conn.id,
                              e.target.value as "two_way" | "outbound_only"
                            )
                          }
                          className="bg-transparent border border-sand rounded px-2 py-0.5 text-xs focus:outline-none"
                        >
                          <option value="two_way">Двусторонняя sync</option>
                          <option value="outbound_only">Только выгрузка</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-borderSoft/50">
                      <span className="text-muted-foreground">Синхронизировано записей:</span>
                      <span className="font-semibold text-taupe">{conn.syncedEventCount}</span>
                    </div>

                    <div className="flex justify-between items-center py-1">
                      <span className="text-muted-foreground">Последняя синхронизация:</span>
                      <span>
                        {conn.lastSyncAt ? new Date(conn.lastSyncAt).toLocaleString("ru-RU") : "Еще не проводилась"}
                      </span>
                    </div>

                    {conn.lastError && (
                      <div className="p-2 bg-red-50 text-red-700 rounded text-[11px] border border-red-100">
                        {conn.lastError}
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="pt-2 flex justify-between gap-2 border-t border-borderSoft/40">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleManualSync(conn.id)}
                      disabled={isSyncing || !canEdit}
                      className="text-xs gap-1.5"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                      {isSyncing ? "Синхронизация..." : "Синхронизировать"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(conn.id)}
                      disabled={isPending || !canEdit}
                      className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Отключить
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Synced Events Log Table */}
      {mappings.length > 0 && (
        <Card className="border-borderSoft">
          <CardHeader>
            <CardTitle className="text-base">Журнал синхронизированных событий</CardTitle>
            <CardDescription>Последние записи, сопоставленные с Google Календарем</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-sand/30 text-taupe uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="p-2.5">Время записи</th>
                    <th className="p-2.5">ID Google Event</th>
                    <th className="p-2.5">Статус CRM</th>
                    <th className="p-2.5">Статус sync</th>
                    <th className="p-2.5">Синхронизировано</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borderSoft">
                  {mappings.map((m) => (
                    <tr key={m.id} className="hover:bg-sand/10">
                      <td className="p-2.5 font-medium">
                        {m.appointmentStartAt ? new Date(m.appointmentStartAt).toLocaleString("ru-RU") : "—"}
                      </td>
                      <td className="p-2.5 font-mono text-[11px] text-muted-foreground truncate max-w-[140px]">
                        {m.googleEventId}
                      </td>
                      <td className="p-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {m.appointmentStatus ?? "confirmed"}
                        </Badge>
                      </td>
                      <td className="p-2.5">
                        <Badge
                          variant="outline"
                          className={
                            m.status === "synced"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                              : "bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
                          }
                        >
                          {m.status}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-muted-foreground">
                        {new Date(m.lastSyncedAt).toLocaleString("ru-RU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
