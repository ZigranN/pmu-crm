"use client";

import { useState } from "react";
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
import { Download, ShieldAlert, UserX, AlertTriangle } from "lucide-react";
import { createPrivacyRequestAction, anonymizeClientAction } from "../server/actions";
import type { PrivacyRequestViewModel } from "../server/queries";

interface ClientPrivacyPanelProps {
  clientId: string;
  clientName: string;
  history: PrivacyRequestViewModel[];
  canExport: boolean;
  canManage?: boolean;
  isOwner: boolean;
}

export function ClientPrivacyPanel({
  clientId,
  clientName,
  history,
  canExport,
  isOwner,
}: ClientPrivacyPanelProps) {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isAnonDialogOpen, setIsAnonDialogOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [anonReason, setAnonReason] = useState("GDAR / Right to be Forgotten");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      await createPrivacyRequestAction({
        clientId,
        requestType: "EXPORT",
        reason: "DSAR data export requested from client profile",
      });
      setIsExportDialogOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create export request");
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymize = async () => {
    if (typedName.trim().toLowerCase() !== clientName.trim().toLowerCase()) {
      setError("Имя клиента не совпадает для подтверждения");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await anonymizeClientAction({
        clientId,
        confirmClientName: typedName,
        reason: anonReason,
      });
      setIsAnonDialogOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to anonymize client");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <span>Конфиденциальность и жизненный цикл данных (DSAR)</span>
          </CardTitle>
          <CardDescription>
            Управление персональными данными клиента в соответствии с GDPR и политиками приватности студии.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-3">
            {canExport && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setIsExportDialogOpen(true)}
              >
                <Download className="h-4 w-4" />
                <span>Запросить экспорт данных (JSON)</span>
              </Button>
            )}

            {isOwner && (
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => {
                  setTypedName("");
                  setError(null);
                  setIsAnonDialogOpen(true);
                }}
              >
                <UserX className="h-4 w-4" />
                <span>Анонимизировать клиента</span>
              </Button>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t">
            <h4 className="text-sm font-medium">История запросов по субъекту данных</h4>
            {history.length > 0 ? (
              <div className="divide-y rounded-md border">
                {history.map((req) => (
                  <div key={req.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{req.requestType}</Badge>
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
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Запросил: {req.requestedByName || "Оператор"} •{" "}
                        {new Date(req.createdAt).toLocaleString("ru-RU")}
                      </p>
                      {req.failureReason && (
                        <p className="text-xs text-destructive">{req.failureReason}</p>
                      )}
                    </div>

                    {req.status === "COMPLETED" && req.requestType === "EXPORT" && (
                      <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                        <a href={`/api/privacy/export/${req.id}/download`} download>
                          <Download className="h-3.5 w-3.5" />
                          <span>Скачать архив</span>
                        </a>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground border rounded-md">
                Запросов на экспорт или анонимизацию пока нет
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Confirmation Dialog */}
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Экспорт данных клиента</DialogTitle>
            <DialogDescription>
              Будет сгенерирован машиночитаемый JSON-бандл, содержащий историю профиля, визитов,
              согласий, процедур и сообщений в рамках данной студии.
            </DialogDescription>
          </DialogHeader>

          {error && <div className="text-sm text-destructive">{error}</div>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleExport} disabled={loading}>
              {loading ? "Формирование..." : "Подтвердить экспорт"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destructive Anonymization Modal */}
      <Dialog open={isAnonDialogOpen} onOpenChange={setIsAnonDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>Необратимая анонимизация клиента</span>
            </DialogTitle>
            <DialogDescription>
              Это действие необратимо удалит прямые персональные данные клиента (ФИО, телефон, email, соцсети,
              заметки). Первичные ключи, финансовый баланс, подписанные согласия и клинические протоколы
              процедур будут сохранены для юридической и бухгалтерской целостности.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Причина анонимизации</Label>
              <Input
                value={anonReason}
                onChange={(e) => setAnonReason(e.target.value)}
                placeholder="Право на забвение / Запрос клиента"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Для подтверждения введите полное имя клиента: <strong className="text-foreground">{clientName}</strong>
              </Label>
              <Input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={clientName}
              />
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAnonDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleAnonymize}
              disabled={loading || typedName.trim().toLowerCase() !== clientName.trim().toLowerCase()}
            >
              {loading ? "Анонимизация..." : "Анонимизировать клиента"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
