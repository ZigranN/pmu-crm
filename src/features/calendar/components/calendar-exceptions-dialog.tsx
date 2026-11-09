"use client";

import React, { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCalendarExceptionAction } from "../server/actions";
import { type CalendarExceptionType } from "../domain/types";
import { parseLocalTimeToUtc } from "../domain/timezone";

interface CalendarExceptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  masters: Array<{ id: string; displayName: string }>;
  defaultDate?: string; // "YYYY-MM-DD"
  defaultMasterId?: string;
  onSuccess?: () => void;
}

export function CalendarExceptionsDialog({
  open,
  onOpenChange,
  timezone,
  masters,
  defaultDate,
  defaultMasterId,
  onSuccess,
}: CalendarExceptionsDialogProps) {
  const todayStr = defaultDate || new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<CalendarExceptionType>("BLOCKED_TIME");
  const [targetMasterId, setTargetMasterId] = useState<string>(
    defaultMasterId || (masters[0]?.id ?? "")
  );
  const [startDate, setStartDate] = useState(todayStr);
  const [startTime, setStartTime] = useState("12:00");
  const [endDate, setEndDate] = useState(todayStr);
  const [endTime, setEndTime] = useState("13:00");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let startAt: Date;
      let endAt: Date;

      if (type === "DAY_OFF") {
        startAt = parseLocalTimeToUtc(startDate, "00:00:00", timezone);
        // End of the day
        endAt = parseLocalTimeToUtc(endDate, "23:59:59", timezone);
      } else {
        startAt = parseLocalTimeToUtc(startDate, startTime, timezone);
        endAt = parseLocalTimeToUtc(endDate, endTime, timezone);
      }

      if (startAt.getTime() >= endAt.getTime()) {
        throw new Error("Время начала должно быть раньше времени окончания.");
      }

      await createCalendarExceptionAction({
        masterId: type === "STUDIO_CLOSURE" ? null : targetMasterId,
        type,
        reason: reason.trim() || undefined,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });

      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err?.message || "Не удалось сохранить блокировку");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить блокировку / выходной</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/50 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="exception-type">Тип блокировки</Label>
            <Select
              value={type}
              onValueChange={(val) => setType(val as CalendarExceptionType)}
            >
              <SelectTrigger id="exception-type">
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOCKED_TIME">
                  Блокировка времени (обед, встреча, дела)
                </SelectItem>
                <SelectItem value="DAY_OFF">Выходной / отпуск мастера</SelectItem>
                <SelectItem value="STUDIO_CLOSURE">
                  Закрытие студии (праздник, ремонт)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type !== "STUDIO_CLOSURE" && (
            <div className="space-y-1.5">
              <Label htmlFor="master-select">Мастер</Label>
              <Select
                value={targetMasterId}
                onValueChange={(val) => setTargetMasterId(val)}
              >
                <SelectTrigger id="master-select">
                  <SelectValue placeholder="Выберите мастера" />
                </SelectTrigger>
                <SelectContent>
                  {masters.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "DAY_OFF" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">С даты</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
                  }}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">По дату</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start-date">Дата начала</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (endDate < e.target.value) setEndDate(e.target.value);
                    }}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start-time">Время начала</Label>
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="end-date">Дата окончания</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end-time">Время окончания</Label>
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">Причина (необязательно)</Label>
            <Input
              id="reason"
              placeholder="Например: Обед, Обучение, Праздничный день"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
