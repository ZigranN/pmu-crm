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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAppointmentAction,
  getBookingOptionsAction,
  getClientCyclesAction,
} from "../server/actions";
import { parseLocalTimeToUtc } from "@/features/calendar/domain/timezone";
import { AlertTriangle, Calendar as CalendarIcon } from "lucide-react";

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  defaultMasterId?: string;
  defaultDate?: string; // YYYY-MM-DD
  defaultTime?: string; // HH:mm
  onSuccess?: () => void;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  timezone,
  defaultMasterId,
  defaultDate,
  defaultTime = "10:00",
  onSuccess,
}: AppointmentDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState<Array<{ id: string; fullName: string; phone: string }>>([]);
  const [masters, setMasters] = useState<Array<{ id: string; displayName: string }>>([]);
  const [services, setServices] = useState<
    Array<{ id: string; name: string; priceCents: number | null; durationMinutes: number | null; procedureType: string }>
  >([]);
  const [cycles, setCycles] = useState<Array<{ id: string; zoneCode: string; stage: string; kind: string }>>([]);

  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedMasterId, setSelectedMasterId] = useState<string>(defaultMasterId || "");
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [visitKind, setVisitKind] = useState<"consultation" | "procedure" | "touch_up">("consultation");
  const [date, setDate] = useState<string>(defaultDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState<string>(defaultTime);
  const [duration, setDuration] = useState<number>(60);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    getBookingOptionsAction()
      .then((opts) => {
        if (!isMounted) return;
        setClients(opts.clients);
        setMasters(opts.masters);
        setServices(opts.services);
        if (defaultMasterId) setSelectedMasterId(defaultMasterId);
        if (defaultDate) setDate(defaultDate);
        if (defaultTime) setTime(defaultTime);
      })
      .catch((err) => {
        console.error("Failed to load booking options", err);
      });
    return () => {
      isMounted = false;
    };
  }, [open, defaultMasterId, defaultDate, defaultTime]);

  useEffect(() => {
    let isMounted = true;
    if (selectedClientId) {
      getClientCyclesAction(selectedClientId)
        .then((c) => {
          if (!isMounted) return;
          setCycles(c);
          setSelectedCycleId(c[0]?.id || "");
        })
        .catch((err) => {
          console.error("Failed to load client cycles", err);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [selectedClientId]);

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    const svc = services.find((s) => s.id === serviceId);
    if (svc && svc.durationMinutes) {
      setDuration(svc.durationMinutes);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedMasterId || !selectedCycleId || !date || !time) {
      setError("Пожалуйста, заполните все обязательные поля");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startsAtUtc = parseLocalTimeToUtc(date, time, timezone);
      const endsAtUtc = new Date(startsAtUtc.getTime() + duration * 60000);

      await createAppointmentAction({
        clientId: selectedClientId,
        masterId: selectedMasterId,
        cycleId: selectedCycleId,
        serviceId: selectedServiceId || undefined,
        visitKind,
        startsAt: startsAtUtc.toISOString(),
        endsAt: endsAtUtc.toISOString(),
        notes: notes || undefined,
        source: "other",
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать запись");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-taupe" />
            Новая запись
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Client Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs">Клиент *</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите клиента" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName} ({c.phone})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Treatment Cycle */}
          <div className="space-y-1.5">
            <Label className="text-xs">Цикл лечения (зона) *</Label>
            {cycles.length === 0 && selectedClientId ? (
              <p className="text-xs text-amber-600">
                У клиента нет активных циклов. Сначала создайте цикл в карточке клиента.
              </p>
            ) : (
              <Select value={selectedCycleId} onValueChange={setSelectedCycleId} disabled={!selectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedClientId ? "Выберите цикл" : "Сначала выберите клиента"} />
                </SelectTrigger>
                <SelectContent>
                  {cycles.map((cy) => (
                    <SelectItem key={cy.id} value={cy.id}>
                      Зона: {cy.zoneCode.toUpperCase()} ({cy.kind}) — этап: {cy.stage}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Master & Visit Kind */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Мастер *</Label>
              <Select value={selectedMasterId} onValueChange={setSelectedMasterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Мастер" />
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

            <div className="space-y-1.5">
              <Label className="text-xs">Тип визита *</Label>
              <Select value={visitKind} onValueChange={(v: "consultation" | "procedure" | "touch_up") => setVisitKind(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultation">Консультация</SelectItem>
                  <SelectItem value="procedure">Процедура</SelectItem>
                  <SelectItem value="touch_up">Коррекция</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Service (Optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs">Услуга</Label>
            <Select value={selectedServiceId} onValueChange={handleServiceChange}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите услугу (опционально)" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes ?? 60} мин, {(((s.priceCents ?? 0)) / 100).toFixed(0)} ₽)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date, Time, Duration */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Дата *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Время *</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Длительность (мин) *</Label>
              <Input
                type="number"
                min="15"
                step="15"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
                required
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Примечание</Label>
            <Input
              placeholder="Дополнительные пожелания или комментарии"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={loading || !selectedClientId || !selectedCycleId}>
              {loading ? "Сохранение..." : "Записать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
