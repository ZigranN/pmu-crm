"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  ShieldAlert,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { completeProcedureAction, abortProcedureAction } from "../server/actions";

export interface ProcedureRecord {
  id: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "ABORTED";
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  abortedAt?: Date | string | null;
  abortReason?: string | null;
  procedureArea: string;
  procedureType: string;
  sessionType: string;
  healingStage?: string | null;
  painLevel?: number | null;
  skinReaction?: string | null;
  notes?: string | null;
  recommendations?: string | null;
  nextStep?: string | null;
  nextRecommendedDate?: Date | string | null;
  anesthesia?: string | null;
  cartridge?: string | null;
  needle?: string | null;
  voltage?: string | null;
  machine?: string | null;
  createdAt: Date | string;
  masterDisplayName?: string | null;
  serviceName?: string | null;
  pigments?: Array<{
    id: string;
    pigmentSnapshot: Record<string, unknown>;
    mixRatio?: string | null;
    drops?: number | null;
    notes?: string | null;
  }>;
}

const STATUS_LABELS: Record<string, { label: string; className: string; icon: any }> = {
  PLANNED: {
    label: "Запланирована",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Clock,
  },
  IN_PROGRESS: {
    label: "В процессе",
    className: "bg-amber-50 text-amber-700 border-amber-200 animate-pulse",
    icon: Play,
  },
  COMPLETED: {
    label: "Завершена",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  ABORTED: {
    label: "Прервана",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
  },
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  primary_session: "Основная процедура",
  second_session: "Вторая процедура / Коррекция",
  correction: "Коррекция",
  refresh: "Обновление (Refresh)",
  touch_up: "Touch-up",
  consultation: "Консультация",
  control: "Контрольный осмотр",
  cover_up: "Перекрытие",
  remover: "Удаление",
};

export function ProcedureHistoryList({
  procedures,
  canManage = true,
}: {
  procedures: ProcedureRecord[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog states
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [abortDialogOpen, setAbortDialogOpen] = useState(false);
  const [selectedProc, setSelectedProc] = useState<ProcedureRecord | null>(null);

  // Complete form fields
  const [recommendations, setRecommendations] = useState("");
  const [healingStage, setHealingStage] = useState<any>("fresh");
  const [notes, setNotes] = useState("");
  const [skinReaction, setSkinReaction] = useState("");
  const [painLevel, setPainLevel] = useState<string>("2");

  // Abort form fields
  const [abortReason, setAbortReason] = useState("");
  const [abortNotes, setAbortNotes] = useState("");

  const handleOpenComplete = (proc: ProcedureRecord) => {
    setSelectedProc(proc);
    setRecommendations(proc.recommendations || "Наносить заживляющий крем тонким слоем. Исключить сауну, бассейн и солярий на 14 дней.");
    setNotes(proc.notes || "");
    setSkinReaction(proc.skinReaction || "Умеренная эритема");
    setPainLevel(proc.painLevel !== null && proc.painLevel !== undefined ? String(proc.painLevel) : "2");
    setCompleteDialogOpen(true);
  };

  const handleOpenAbort = (proc: ProcedureRecord) => {
    setSelectedProc(proc);
    setAbortReason("");
    setAbortNotes("");
    setAbortDialogOpen(true);
  };

  const handleCompleteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProc) return;

    startTransition(async () => {
      try {
        const reqKey = crypto.randomUUID();
        await completeProcedureAction(
          {
            procedureSessionId: selectedProc.id,
            pigments: [],
            recommendations: recommendations.trim() || undefined,
            healingStage: healingStage || undefined,
            notes: notes.trim() || undefined,
            skinReaction: skinReaction.trim() || undefined,
            painLevel: painLevel ? parseInt(painLevel, 10) : undefined,
          },
          reqKey
        );
        toast.success("Протокол процедуры успешно сохранён и завершён.");
        setCompleteDialogOpen(false);
        router.refresh();
      } catch (err: any) {
        toast.error(err?.message || "Не удалось завершить процедуру.");
      }
    });
  };

  const handleAbortSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProc || abortReason.trim().length < 3) return;

    startTransition(async () => {
      try {
        const reqKey = crypto.randomUUID();
        await abortProcedureAction(
          {
            procedureSessionId: selectedProc.id,
            reason: abortReason.trim(),
            notes: abortNotes.trim() || undefined,
          },
          reqKey
        );
        toast.success("Процедура прервана. Причина зафиксирована в протоколе.");
        setAbortDialogOpen(false);
        router.refresh();
      } catch (err: any) {
        toast.error(err?.message || "Не удалось прервать процедуру.");
      }
    });
  };

  if (!procedures || procedures.length === 0) {
    return <p className="text-sm text-muted-foreground">Процедуры пока не проводились.</p>;
  }

  return (
    <div className="space-y-4">
      {procedures.map((proc) => {
        const statusConfig = STATUS_LABELS[proc.status] || {
          label: proc.status,
          className: "bg-muted text-muted-foreground border-border",
          icon: Clock,
        };
        const StatusIcon = statusConfig.icon;
        const isInProgress = proc.status === "IN_PROGRESS";

        return (
          <div
            key={proc.id}
            className="rounded-lg border bg-card p-4 text-card-foreground shadow-2xs space-y-3"
            data-testid={`procedure-item-${proc.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold ${statusConfig.className}`}
                >
                  <StatusIcon className="w-3 h-3" />
                  <span>{statusConfig.label}</span>
                </Badge>
                <span className="font-medium text-sm">
                  {SESSION_TYPE_LABELS[proc.sessionType] || proc.sessionType}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(proc.startedAt || proc.createdAt).toLocaleString("ru-RU")}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Мастер: </span>
                <span className="font-medium">{proc.masterDisplayName || "Не указан"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Услуга: </span>
                <span className="font-medium">{proc.serviceName || proc.procedureType}</span>
              </div>
              {proc.completedAt && (
                <div>
                  <span className="text-muted-foreground">Завершена: </span>
                  <span>{new Date(proc.completedAt).toLocaleString("ru-RU")}</span>
                </div>
              )}
              {proc.abortedAt && (
                <div className="text-destructive col-span-2">
                  <span className="font-medium">Прервана: </span>
                  <span>{proc.abortReason || "Причина не указана"}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({new Date(proc.abortedAt).toLocaleString("ru-RU")})
                  </span>
                </div>
              )}
            </div>

            {/* Evidence & Material Details */}
            {(proc.machine || proc.needle || proc.anesthesia || proc.cartridge || proc.voltage) && (
              <div className="bg-muted/40 p-2.5 rounded-md text-xs grid grid-cols-2 sm:grid-cols-3 gap-2 border border-border/50">
                {proc.machine && (
                  <div>
                    <span className="text-muted-foreground">Аппарат: </span>
                    <span className="font-medium">{proc.machine}</span>
                  </div>
                )}
                {proc.needle && (
                  <div>
                    <span className="text-muted-foreground">Игла: </span>
                    <span className="font-medium">{proc.needle}</span>
                  </div>
                )}
                {proc.cartridge && (
                  <div>
                    <span className="text-muted-foreground">Картридж: </span>
                    <span className="font-medium">{proc.cartridge}</span>
                  </div>
                )}
                {proc.voltage && (
                  <div>
                    <span className="text-muted-foreground">Вольтаж: </span>
                    <span className="font-medium">{proc.voltage}</span>
                  </div>
                )}
                {proc.anesthesia && (
                  <div>
                    <span className="text-muted-foreground">Анестезия: </span>
                    <span className="font-medium">{proc.anesthesia}</span>
                  </div>
                )}
                {proc.painLevel !== null && proc.painLevel !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Уровень боли: </span>
                    <span className="font-medium">{proc.painLevel}/10</span>
                  </div>
                )}
                {proc.skinReaction && (
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-muted-foreground">Реакция кожи: </span>
                    <span>{proc.skinReaction}</span>
                  </div>
                )}
              </div>
            )}

            {/* Pigments */}
            {proc.pigments && proc.pigments.length > 0 && (
              <div className="text-xs space-y-1">
                <span className="font-medium text-muted-foreground">Использованные пигменты:</span>
                <ul className="list-disc list-inside space-y-0.5 text-foreground/90 pl-1">
                  {proc.pigments.map((pigment, idx) => {
                    const snap = (pigment.pigmentSnapshot || {}) as Record<string, any>;
                    return (
                      <li key={idx}>
                        <strong>{snap.brand || "Пигмент"}</strong> - {snap.name || snap.code || ""}{" "}
                        {snap.color ? `(${snap.color})` : ""}
                        {pigment.drops ? ` · ${pigment.drops} кап.` : ""}
                        {pigment.mixRatio ? ` · пропорция ${pigment.mixRatio}` : ""}
                        {pigment.notes ? ` · ${pigment.notes}` : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Notes & Recommendations */}
            {proc.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground font-medium">Заметки: </span>
                <span className="whitespace-pre-wrap">{proc.notes}</span>
              </div>
            )}
            {proc.recommendations && (
              <div className="text-sm text-emerald-950 bg-emerald-50/70 p-2.5 rounded-md border border-emerald-200/60">
                <span className="font-medium text-emerald-900">Рекомендации по уходу: </span>
                <span className="whitespace-pre-wrap">{proc.recommendations}</span>
              </div>
            )}

            {/* In-progress Action Buttons */}
            {isInProgress && canManage && (
              <div className="pt-2 border-t flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={() => handleOpenAbort(proc)}
                  disabled={isPending}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" />
                  <span>Прервать процедуру</span>
                </Button>

                <Button
                  type="button"
                  size="sm"
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handleOpenComplete(proc)}
                  disabled={isPending}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  <span>Завершить процедуру</span>
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {/* Completion Protocol Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Завершение процедуры и протокол</span>
            </DialogTitle>
            <DialogDescription>
              Зафиксируйте протокол выполненной процедуры и рекомендации клиенту.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCompleteSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="complete-recommendations">Рекомендации по домашнему уходу</Label>
              <Textarea
                id="complete-recommendations"
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="Инструкция для клиента по уходу за зоной..."
                className="text-xs min-h-[70px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="complete-stage">Стадия заживления</Label>
              <Select value={healingStage} onValueChange={setHealingStage}>
                <SelectTrigger id="complete-stage" className="text-xs h-9">
                  <SelectValue placeholder="Выберите стадию" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresh">Свежая (fresh)</SelectItem>
                  <SelectItem value="day_2_3">2-3 день (day_2_3)</SelectItem>
                  <SelectItem value="day_7">7 день (day_7)</SelectItem>
                  <SelectItem value="day_30">30 день (day_30)</SelectItem>
                  <SelectItem value="healed">Полностью зажившая (healed)</SelectItem>
                  <SelectItem value="needs_correction">Требуется коррекция</SelectItem>
                  <SelectItem value="completed">Завершено</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="complete-skin">Реакция кожи</Label>
                <Input
                  id="complete-skin"
                  value={skinReaction}
                  onChange={(e) => setSkinReaction(e.target.value)}
                  placeholder="Эритема, отёк..."
                  className="text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="complete-pain">Уровень боли (0–10)</Label>
                <Input
                  id="complete-pain"
                  type="number"
                  min="0"
                  max="10"
                  value={painLevel}
                  onChange={(e) => setPainLevel(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="complete-notes">Заметки специалиста</Label>
              <Textarea
                id="complete-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Технические особенности, остаток пигмента..."
                className="text-xs min-h-[60px]"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCompleteDialogOpen(false)}
                disabled={isPending}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isPending}
              >
                {isPending ? "Сохранение..." : "Подтвердить завершение"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Abort Confirmation Dialog */}
      <Dialog open={abortDialogOpen} onOpenChange={setAbortDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              <span>Прерывание процедуры</span>
            </DialogTitle>
            <DialogDescription>
              Прерывание является необратимым действием. Укажите клиническую или оперативную причину остановки процедуры.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAbortSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="abort-reason" className="text-destructive font-medium">
                Причина прерывания (обязательно) *
              </Label>
              <Input
                id="abort-reason"
                value={abortReason}
                onChange={(e) => setAbortReason(e.target.value)}
                placeholder="Аллергическая реакция, обморок, отказ клиента..."
                required
                minLength={3}
                className="text-xs border-destructive/50 focus-visible:ring-destructive"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="abort-notes">Дополнительный комментарий</Label>
              <Textarea
                id="abort-notes"
                value={abortNotes}
                onChange={(e) => setAbortNotes(e.target.value)}
                placeholder="Оказанная помощь, текущее состояние клиента..."
                className="text-xs min-h-[60px]"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAbortDialogOpen(false)}
                disabled={isPending}
              >
                Назад
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={isPending || abortReason.trim().length < 3}
              >
                {isPending ? "Прерывание..." : "Прервать процедуру"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
