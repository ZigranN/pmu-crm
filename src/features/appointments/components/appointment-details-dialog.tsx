"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  getAppointmentDetailsAction,
  rescheduleAppointmentAction,
  cancelAppointmentAction,
} from "../server/actions";
import { parseLocalTimeToUtc } from "@/features/calendar/domain/timezone";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Clock,
  ShieldCheck,
  FileCheck,
  CreditCard,
} from "lucide-react";
import { formatCents } from "@/lib/money";
import { getFriendlyErrorMessage } from "@/lib/observability/error-taxonomy";

interface AppointmentDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string | null;
  timezone: string;
  onSuccess?: () => void;
}

export function AppointmentDetailsDialog({
  open,
  onOpenChange,
  appointmentId,
  timezone,
  onSuccess,
}: AppointmentDetailsDialogProps) {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reschedule state
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newDuration, setNewDuration] = useState(60);
  const [rescheduleReason, setRescheduleReason] = useState("");

  // Cancel state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!open || !appointmentId) return;
    let isMounted = true;
    getAppointmentDetailsAction(appointmentId)
      .then((data) => {
        if (!isMounted) return;
        setDetails(data);
        const start = new Date(data.appointment.startAt);
        const end = new Date(data.appointment.endAt);
        const durationMins = Math.round((end.getTime() - start.getTime()) / 60000);

        const localDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(start);

        const localTimeStr = new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(start);

        setNewDate(localDateStr);
        setNewTime(localTimeStr);
        setNewDuration(durationMins);
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить данные записи");
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [open, appointmentId, timezone]);

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentId || !newDate || !newTime) return;

    setActionLoading(true);
    setError(null);

    try {
      const startsAtUtc = parseLocalTimeToUtc(newDate, newTime, timezone);
      const endsAtUtc = new Date(startsAtUtc.getTime() + newDuration * 60000);

      await rescheduleAppointmentAction({
        appointmentId,
        startsAt: startsAtUtc.toISOString(),
        endsAt: endsAtUtc.toISOString(),
        reason: rescheduleReason || undefined,
      });

      setIsRescheduling(false);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentId) return;

    setActionLoading(true);
    setError(null);

    try {
      await cancelAppointmentAction({
        appointmentId,
        reason: cancelReason || undefined,
      });

      setIsCancelling(false);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-taupe" />
            Детали записи
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading || !details ? (
          <div className="py-8 text-center text-sm text-textMuted">Загрузка информации о записи...</div>
        ) : (
          <div className="space-y-4 py-1 text-sm">
            {/* Status & Timing */}
            <div className="bg-secondary/40 p-3 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-textMuted font-medium uppercase">Статус записи:</span>
                <Badge
                  variant={
                    details.appointment.status === "cancelled"
                      ? "destructive"
                      : details.appointment.status === "confirmed"
                      ? "default"
                      : "secondary"
                  }
                  className="capitalize"
                >
                  {details.appointment.status === "confirmed"
                    ? "Подтверждена"
                    : details.appointment.status === "cancelled"
                    ? "Отменена"
                    : details.appointment.status === "completed"
                    ? "Завершена"
                    : details.appointment.status}
                </Badge>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs text-foreground">
                <Clock className="h-4 w-4 text-taupe" />
                <span>
                  {new Date(details.appointment.startAt).toLocaleString([], {
                    timeZone: timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  —{" "}
                  {new Date(details.appointment.endAt).toLocaleTimeString([], {
                    timeZone: timezone,
                    timeStyle: "short",
                  })}
                </span>
              </div>
            </div>

            {/* Client & Master */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="border p-2.5 rounded-lg space-y-1">
                <span className="text-textMuted font-medium">Клиент:</span>
                <p className="font-semibold text-foreground text-sm">{details.client?.fullName}</p>
                <p className="text-textMuted">{details.client?.phone}</p>
              </div>

              <div className="border p-2.5 rounded-lg space-y-1">
                <span className="text-textMuted font-medium">Мастер:</span>
                <p className="font-semibold text-foreground text-sm">{details.master?.displayName}</p>
                <p className="text-textMuted">Зона: {details.cycle?.zoneCode?.toUpperCase() || "—"}</p>
              </div>
            </div>

            {/* Medical & Consent Guards Summary */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="border p-2.5 rounded-lg space-y-1 bg-muted/20">
                <div className="flex items-center gap-1.5 font-medium text-textMuted">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                  <span>Мед. статус:</span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    details.medicalSummary?.status === "CLEARED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-amber-50 text-amber-700 border-amber-300"
                  }
                >
                  {details.medicalSummary?.status || "NOT_APPLICABLE"}
                </Badge>
              </div>

              <div className="border p-2.5 rounded-lg space-y-1 bg-muted/20">
                <div className="flex items-center gap-1.5 font-medium text-textMuted">
                  <FileCheck className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Согласие:</span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    details.consentSummary?.status === "COVERED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-slate-100 text-slate-700 border-slate-300"
                  }
                >
                  {details.consentSummary?.status || "NOT_REQUIRED"}
                </Badge>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="border p-2.5 rounded-lg space-y-2 bg-muted/10 text-xs">
              <div className="flex items-center justify-between font-medium text-textMuted border-b pb-1.5">
                <div className="flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Финансовое состояние</span>
                </div>
                <span className="font-semibold text-foreground">
                  {formatCents(details.financialSummary?.expectedPriceCents ?? details.appointment.priceSnapshotCents)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-0.5">
                <div className="bg-background/80 p-1.5 rounded border">
                  <span className="text-[10px] text-muted-foreground block">Ожидается</span>
                  <span className="font-semibold text-foreground">
                    {formatCents(details.financialSummary?.expectedPriceCents ?? details.appointment.priceSnapshotCents)}
                  </span>
                </div>
                <div className="bg-background/80 p-1.5 rounded border">
                  <span className="text-[10px] text-muted-foreground block">Оплачено</span>
                  <span className="font-semibold text-emerald-600">
                    {formatCents(details.financialSummary?.paidAmountCents ?? 0)}
                  </span>
                </div>
                <div className="bg-background/80 p-1.5 rounded border">
                  <span className="text-[10px] text-muted-foreground block">Остаток</span>
                  <span className={`font-semibold ${(details.financialSummary?.outstandingAmountCents ?? details.appointment.priceSnapshotCents) > 0 ? "text-amber-600" : "text-foreground"}`}>
                    {formatCents(details.financialSummary?.outstandingAmountCents ?? details.appointment.priceSnapshotCents)}
                  </span>
                </div>
              </div>
              {details.financialSummary?.entries && details.financialSummary.entries.length > 0 && (
                <div className="mt-2 pt-2 border-t space-y-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">История платежей</span>
                  <div className="max-h-24 overflow-y-auto space-y-1">
                    {details.financialSummary.entries.map((entry: any) => (
                      <div key={entry.id} className="flex justify-between items-center text-[11px] bg-background/60 px-2 py-1 rounded">
                        <span className="text-muted-foreground">{entry.reason} ({entry.type})</span>
                        <span className={`font-medium ${entry.type === "PAYMENT" ? "text-emerald-600" : entry.type === "REFUND" ? "text-red-600" : ""}`}>
                          {entry.type === "REFUND" ? "−" : ""}{formatCents(entry.amountMinor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Notes or Cancellation Reason */}
            {details.appointment.notes && (
              <div className="text-xs bg-muted/30 p-2.5 rounded-lg">
                <span className="text-textMuted font-medium">Примечание: </span>
                <span>{details.appointment.notes}</span>
              </div>
            )}

            {details.appointment.cancelReason && (
              <div className="text-xs bg-destructive/10 text-destructive p-2.5 rounded-lg">
                <span className="font-medium">Причина отмены: </span>
                <span>{details.appointment.cancelReason}</span>
              </div>
            )}

            {/* Reschedule View */}
            {isRescheduling && (
              <form onSubmit={handleRescheduleSubmit} className="border-t pt-3 space-y-3">
                <h4 className="font-semibold text-xs uppercase text-textMuted">Перенос записи</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Новая дата</Label>
                    <Input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Новое время</Label>
                    <Input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[11px]">Причина переноса</Label>
                  <Input
                    placeholder="Причина (опционально)"
                    value={rescheduleReason}
                    onChange={(e) => setRescheduleReason(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsRescheduling(false)}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" size="sm" disabled={actionLoading}>
                    {actionLoading ? "Сохранение..." : "Подтвердить перенос"}
                  </Button>
                </div>
              </form>
            )}

            {/* Cancel View */}
            {isCancelling && (
              <form onSubmit={handleCancelSubmit} className="border-t pt-3 space-y-3">
                <h4 className="font-semibold text-xs uppercase text-destructive">
                  Подтверждение отмены записи
                </h4>
                <div>
                  <Label className="text-[11px]">Укажите причину отмены</Label>
                  <Input
                    placeholder="Причина отмены"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 justify-end pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCancelling(false)}
                  >
                    Назад
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    disabled={actionLoading}
                  >
                    {actionLoading ? "Отмена..." : "Отменить запись"}
                  </Button>
                </div>
              </form>
            )}

            {/* Action buttons when not in inline sub-forms */}
            {!isRescheduling && !isCancelling && details.appointment.status !== "cancelled" && (
              <DialogFooter className="pt-3 border-t flex items-center justify-between">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsCancelling(true)}
                >
                  Отменить
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsRescheduling(true)}
                  >
                    Перенести
                  </Button>
                  <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                    Закрыть
                  </Button>
                </div>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
