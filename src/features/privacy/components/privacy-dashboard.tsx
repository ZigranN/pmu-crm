"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldAlert,
  Download,
  CheckCircle,
  XCircle,
  RotateCw,
  HardDrive,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { PrivacyRequestViewModel } from "../server/queries";
import {
  approvePrivacyRequestAction,
  cancelPrivacyRequestAction,
  updateStudioRetentionPolicyAction,
  triggerRetentionCleanupAction,
} from "../server/actions";
import Link from "next/link";

interface PrivacyDashboardProps {
  requests: PrivacyRequestViewModel[];
  retentionPolicy: {
    temporaryUploadRetentionDays: number;
    privacyExportRetentionDays: number;
    orphanMediaGraceDays: number;
  };
  canManage: boolean;
  canExport: boolean;
  isOwner: boolean;
}

export function PrivacyDashboard({
  requests,
  retentionPolicy,
  canManage,
  canExport,
  isOwner,
}: PrivacyDashboardProps) {
  const [activeTab, setActiveTab] = useState("requests");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Retention policy state
  const [tempDays, setTempDays] = useState(retentionPolicy.temporaryUploadRetentionDays);
  const [exportDays, setExportDays] = useState(retentionPolicy.privacyExportRetentionDays);
  const [orphanDays, setOrphanDays] = useState(retentionPolicy.orphanMediaGraceDays);
  const [policySaving, setPolicySaving] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  // Cancel dialog state
  const [cancelModalReq, setCancelModalReq] = useState<PrivacyRequestViewModel | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const handleApprove = async (req: PrivacyRequestViewModel) => {
    setLoadingId(req.id);
    setError(null);
    try {
      await approvePrivacyRequestAction({ requestId: req.id });
      setSuccessMsg(`Запрос ${req.requestType} для клиента ${req.clientName} одобрен и исполнен`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось одобрить запрос");
    } finally {
      setLoadingId(null);
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelModalReq) return;
    setLoadingId(cancelModalReq.id);
    setError(null);
    try {
      await cancelPrivacyRequestAction({
        requestId: cancelModalReq.id,
        reason: cancelReason || "Отклонено оператором",
      });
      setCancelModalReq(null);
      setCancelReason("");
      setSuccessMsg("Запрос успешно отменён");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось отменить запрос");
    } finally {
      setLoadingId(null);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setPolicySaving(true);
    setError(null);
    try {
      await updateStudioRetentionPolicyAction({
        temporaryUploadRetentionDays: Number(tempDays),
        privacyExportRetentionDays: Number(exportDays),
        orphanMediaGraceDays: Number(orphanDays),
      });
      setSuccessMsg("Политика хранения данных успешно обновлена");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить политику");
    } finally {
      setPolicySaving(false);
    }
  };

  const handleTriggerCleanup = async () => {
    setCleanupRunning(true);
    setError(null);
    try {
      const res = await triggerRetentionCleanupAction();
      setSuccessMsg(
        `Очистка завершена: удалено ${res.result.orphanMediaCount} файлов, ${res.result.expiredExportsCount} архивов. Сохранено свидетельств: ${res.result.preservedEvidenceCount}`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка при очистке данных");
    } finally {
      setCleanupRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm border border-destructive/20 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-md bg-primary/10 text-primary text-sm border border-primary/20 flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="requests" className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            <span>Запросы DSAR</span>
          </TabsTrigger>
          <TabsTrigger value="retention" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span>Политики хранения</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Requests queue */}
        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Очередь запросов субъектов данных</CardTitle>
              <CardDescription>
                Обработка запросов на экспорт, анонимизацию и удаление данных в рамках регламента GDPR.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {requests.length > 0 ? (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Клиент</th>
                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Тип запроса</th>
                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Статус</th>
                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Запросил</th>
                        <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Дата создания</th>
                        <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {requests.map((req) => (
                        <tr key={req.id} className="border-b transition-colors hover:bg-muted/50">
                          <td className="p-4 align-middle font-medium">
                            <Link href={`/clients/${req.clientId}`} className="hover:underline text-primary">
                              {req.clientName}
                            </Link>
                            {req.clientPhone && (
                              <p className="text-xs text-muted-foreground">{req.clientPhone}</p>
                            )}
                          </td>
                          <td className="p-4 align-middle">
                            <Badge variant="outline">{req.requestType}</Badge>
                          </td>
                          <td className="p-4 align-middle">
                            <Badge
                              variant={
                                req.status === "COMPLETED"
                                  ? "default"
                                  : req.status === "FAILED" || req.status === "CANCELLED"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {req.status}
                            </Badge>
                          </td>
                          <td className="p-4 align-middle">
                            <span className="text-sm">{req.requestedByName || "Оператор"}</span>
                          </td>
                          <td className="p-4 align-middle">
                            <span className="text-xs text-muted-foreground">
                              {new Date(req.createdAt).toLocaleString("ru-RU")}
                            </span>
                          </td>
                          <td className="p-4 align-middle text-right space-x-2">
                            {req.status === "REQUESTED" && canManage && (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-8 gap-1 text-xs"
                                  onClick={() => handleApprove(req)}
                                  disabled={loadingId === req.id}
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  <span>Одобрить</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10"
                                  onClick={() => setCancelModalReq(req)}
                                  disabled={loadingId === req.id}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span>Отклонить</span>
                                </Button>
                              </>
                            )}

                            {req.status === "COMPLETED" && req.requestType === "EXPORT" && canExport && (
                              <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs">
                                <a href={`/api/privacy/export/${req.id}/download`} download>
                                  <Download className="h-3.5 w-3.5" />
                                  <span>Скачать JSON</span>
                                </a>
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground border rounded-md">
                  Нет активных запросов на экспорт или анонимизацию
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Retention Policy Settings */}
        <TabsContent value="retention" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Параметры хранения и очистки данных</CardTitle>
              <CardDescription>
                Конфигурация сроков автоматического удаления временных файлов, экспортов и неиспользуемых медиа.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSavePolicy} className="space-y-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="tempDays">Хранение временных загрузок (дней)</Label>
                  <Input
                    id="tempDays"
                    type="number"
                    min="1"
                    max="365"
                    value={tempDays}
                    onChange={(e) => setTempDays(Number(e.target.value))}
                    disabled={!isOwner}
                  />
                  <p className="text-xs text-muted-foreground">
                    Срок, по истечении которого незавершённые загрузки считаются устаревшими.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exportDays">Хранение сгенерированных архивов экспорта (дней)</Label>
                  <Input
                    id="exportDays"
                    type="number"
                    min="1"
                    max="365"
                    value={exportDays}
                    onChange={(e) => setExportDays(Number(e.target.value))}
                    disabled={!isOwner}
                  />
                  <p className="text-xs text-muted-foreground">
                    Срок доступности ссылки на скачивание архива данных клиента.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orphanDays">Период ожидания перед удалением потерянных медиа (дней)</Label>
                  <Input
                    id="orphanDays"
                    type="number"
                    min="1"
                    max="365"
                    value={orphanDays}
                    onChange={(e) => setOrphanDays(Number(e.target.value))}
                    disabled={!isOwner}
                  />
                  <p className="text-xs text-muted-foreground">
                    Двухэтапная защита: мягко удалённые файлы удаляются физически только после этого срока.
                  </p>
                </div>

                {isOwner && (
                  <Button type="submit" disabled={policySaving}>
                    {policySaving ? "Сохранение..." : "Сохранить параметры"}
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Регламентная очистка хранилища</CardTitle>
              <CardDescription>
                Ручной запуск сборщика мусора для удаления просроченных экспортов и осиротевших файлов.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-md bg-muted text-sm space-y-2">
                <p className="font-medium text-foreground">Гарантия сохранности юридических и медицинских свидетельств:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
                  <li>Подписанные бланки согласий и PDF-документы никогда не удаляются сборщиком мусора.</li>
                  <li>Клинические фото протоколов процедур (до/после/заживление) сохраняются в обязательном порядке.</li>
                  <li>Финансовые записи в журнале операций строго защищены от удаления и модификации.</li>
                </ul>
              </div>

              {canManage && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleTriggerCleanup}
                  disabled={cleanupRunning}
                >
                  <RotateCw className={`h-4 w-4 ${cleanupRunning ? "animate-spin" : ""}`} />
                  <span>{cleanupRunning ? "Выполняется очистка..." : "Запустить очистку хранилища"}</span>
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reject / Cancel Modal */}
      <Dialog open={!!cancelModalReq} onOpenChange={(open) => !open && setCancelModalReq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить запрос</DialogTitle>
            <DialogDescription>
              Укажите причину отмены запроса субъекта данных ({cancelModalReq?.requestType}).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="cancelReason">Причина отмены</Label>
            <Input
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ошибочный запрос / Запрос отозван клиентом"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelModalReq(null)}>
              Назад
            </Button>
            <Button variant="destructive" onClick={handleCancelSubmit} disabled={loadingId !== null}>
              {loadingId ? "Отмена..." : "Отклонить запрос"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
