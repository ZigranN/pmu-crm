"use client";

import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  User,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarExceptionsDialog } from "./calendar-exceptions-dialog";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { AppointmentDetailsDialog } from "@/features/appointments/components/appointment-details-dialog";
import { getStudioCalendarViewAction } from "../server/actions";
import { type StudioCalendarViewModel } from "../server/availability";
import { addDaysToDateString, getWeekDates } from "../domain/timezone";

interface CalendarViewProps {
  initialViewModel: StudioCalendarViewModel;
  allMasters: Array<{ id: string; displayName: string }>;
  canManage?: boolean;
}

export function CalendarView({
  initialViewModel,
  allMasters,
  canManage = true,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<"day" | "week">("week");
  const [currentDate, setCurrentDate] = useState(
    initialViewModel.startDate || new Date().toISOString().slice(0, 10)
  );
  const [selectedMasterId, setSelectedMasterId] = useState<string>("all");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [viewModel, setViewModel] = useState<StudioCalendarViewModel>(initialViewModel);
  const [loading, setLoading] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [bookingDialogParams, setBookingDialogParams] = useState<{
    masterId?: string;
    date?: string;
    time?: string;
  }>({});
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  const timezone = viewModel.timezone || "UTC";

  // Calculate current date range based on viewMode and currentDate
  const getDateRange = (dateStr: string, mode: "day" | "week") => {
    if (mode === "day") {
      return { startDate: dateStr, endDate: dateStr };
    }
    const week = getWeekDates(dateStr, timezone);
    return { startDate: week.startDate, endDate: week.endDate };
  };

  const loadCalendar = async (
    dateStr: string,
    mode: "day" | "week",
    masterId: string,
    duration: number
  ) => {
    setLoading(true);
    try {
      const range = getDateRange(dateStr, mode);
      const data = await getStudioCalendarViewAction({
        startDate: range.startDate,
        endDate: range.endDate,
        masterId: masterId === "all" ? undefined : masterId,
        durationMinutes: duration,
      });
      setViewModel(data);
    } catch (err) {
      console.error("Failed to load calendar view", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => {
    const offset = viewMode === "day" ? -1 : -7;
    const newDate = addDaysToDateString(currentDate, offset);
    setCurrentDate(newDate);
    loadCalendar(newDate, viewMode, selectedMasterId, durationMinutes);
  };

  const handleNext = () => {
    const offset = viewMode === "day" ? 1 : 7;
    const newDate = addDaysToDateString(currentDate, offset);
    setCurrentDate(newDate);
    loadCalendar(newDate, viewMode, selectedMasterId, durationMinutes);
  };

  const handleToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setCurrentDate(today);
    loadCalendar(today, viewMode, selectedMasterId, durationMinutes);
  };

  const handleViewModeChange = (mode: "day" | "week") => {
    setViewMode(mode);
    loadCalendar(currentDate, mode, selectedMasterId, durationMinutes);
  };

  const handleMasterChange = (masterId: string) => {
    setSelectedMasterId(masterId);
    loadCalendar(currentDate, viewMode, masterId, durationMinutes);
  };

  const handleDurationChange = (val: string) => {
    const duration = parseInt(val, 10);
    setDurationMinutes(duration);
    loadCalendar(currentDate, viewMode, selectedMasterId, duration);
  };

  const handleOpenCreateAppointment = (masterId?: string, date?: string, time?: string) => {
    setBookingDialogParams({ masterId, date, time });
    setBookingDialogOpen(true);
  };

  const handleOpenAppointmentDetails = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    setDetailsDialogOpen(true);
  };

  const formatDisplayDateHeader = () => {
    if (viewMode === "day") {
      const [, m, d] = currentDate.split("-");
      const [y] = currentDate.split("-");
      return `${d}.${m}.${y}`;
    }
    const week = getWeekDates(currentDate, timezone);
    const [, sm, sd] = week.startDate.split("-");
    const [ey, em, ed] = week.endDate.split("-");
    return `${sd}.${sm} — ${ed}.${em}.${ey}`;
  };

  const weekdayNames = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  return (
    <div className="space-y-6">
      {/* Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        {/* Date navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleToday} disabled={loading}>
            Сегодня
          </Button>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handlePrev}
              disabled={loading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-sm px-2 min-w-32 text-center select-none">
              {formatDisplayDateHeader()}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleNext}
              disabled={loading}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <input
            type="date"
            value={currentDate}
            onChange={(e) => {
              if (e.target.value) {
                setCurrentDate(e.target.value);
                loadCalendar(e.target.value, viewMode, selectedMasterId, durationMinutes);
              }
            }}
            className="text-xs border rounded px-2 py-1 bg-background text-foreground cursor-pointer"
          />
        </div>

        {/* View Mode & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={viewMode}
            onValueChange={(val) => handleViewModeChange(val as "day" | "week")}
          >
            <TabsList className="h-9">
              <TabsTrigger value="week" className="text-xs">
                Неделя
              </TabsTrigger>
              <TabsTrigger value="day" className="text-xs">
                День
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={selectedMasterId} onValueChange={handleMasterChange}>
            <SelectTrigger className="h-9 w-40 text-xs">
              <SelectValue placeholder="Мастер" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все мастера</SelectItem>
              {allMasters.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(durationMinutes)}
            onValueChange={handleDurationChange}
          >
            <SelectTrigger className="h-9 w-32 text-xs">
              <Clock className="h-3.5 w-3.5 mr-1 text-taupe" />
              <SelectValue placeholder="Длительность" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 мин</SelectItem>
              <SelectItem value="45">45 мин</SelectItem>
              <SelectItem value="60">60 мин (1ч)</SelectItem>
              <SelectItem value="90">90 мин (1.5ч)</SelectItem>
              <SelectItem value="120">120 мин (2ч)</SelectItem>
            </SelectContent>
          </Select>

          {canManage && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() =>
                  handleOpenCreateAppointment(
                    selectedMasterId !== "all" ? selectedMasterId : undefined,
                    currentDate
                  )
                }
              >
                <Plus className="h-4 w-4" />
                <span>Запись</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => setExceptionDialogOpen(true)}
              >
                <Lock className="h-4 w-4" />
                <span>Блокировка</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Studio Closures Banner */}
      {viewModel.studioClosures && viewModel.studioClosures.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 rounded-lg text-amber-800 dark:text-amber-200 text-sm flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <span className="font-semibold">Внимание! Закрытие студии:</span>{" "}
            {viewModel.studioClosures.map((sc, i) => (
              <span key={sc.id || i}>
                {sc.reason ? `${sc.reason} ` : ""}
                ({new Date(sc.startAt).toLocaleDateString()} —{" "}
                {new Date(sc.endAt).toLocaleDateString()})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Masters Schedule Matrix */}
      {viewModel.masters.length === 0 ? (
        <Card className="py-12 text-center text-textMuted">
          <CardContent>
            <User className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="font-medium">Мастера не найдены</p>
            <p className="text-xs text-textMuted">
              Добавьте мастеров или настройте фильтры отображения.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {viewModel.masters.map((masterItem) => (
            <div
              key={masterItem.master.id}
              className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4"
            >
              {/* Master Header */}
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-taupe/15 flex items-center justify-center font-bold text-taupe text-sm">
                    {masterItem.master.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-foreground">
                      {masterItem.master.displayName}
                    </h3>
                    <p className="text-xs text-textMuted">
                      Часовой пояс студии: {viewModel.timezone}
                    </p>
                  </div>
                </div>
              </div>

              {/* Day / Week Columns */}
              <div
                className={`grid gap-3 ${
                  viewMode === "day"
                    ? "grid-cols-1"
                    : "grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7"
                }`}
              >
                {masterItem.days.map((day) => {
                  const [, m, d] = day.date.split("-");
                  const weekdayName = weekdayNames[day.weekday];
                  const isToday =
                    day.date === new Date().toISOString().slice(0, 10);

                  return (
                    <div
                      key={day.date}
                      className={`border rounded-lg p-3 flex flex-col justify-between transition-colors ${
                        isToday
                          ? "bg-taupe/5 border-taupe/40 ring-1 ring-taupe/20"
                          : day.isWorkingDay
                          ? "bg-background border-border/80"
                          : "bg-muted/40 border-dashed border-border text-textMuted"
                      }`}
                    >
                      {/* Day Header */}
                      <div className="flex items-center justify-between border-b pb-2 mb-2">
                        <div>
                          <div className="text-xs font-semibold text-textMuted uppercase">
                            {weekdayName}
                          </div>
                          <div className="text-sm font-bold">
                            {d}.{m}
                          </div>
                        </div>

                        {day.isWorkingDay ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 h-5"
                          >
                            Рабочий
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-[10px] text-textMuted h-5"
                          >
                            Выходной
                          </Badge>
                        )}
                      </div>

                      {/* Day Content */}
                      <div className="space-y-2.5 text-xs flex-1">
                        {/* Working Intervals */}
                        {day.workingIntervals.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-textMuted font-medium uppercase">
                              Рабочие часы:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {day.workingIntervals.map((wi, i) => (
                                <span
                                  key={i}
                                  className="bg-secondary px-1.5 py-0.5 rounded text-[11px] font-mono"
                                >
                                  {new Date(wi.startAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                  —
                                  {new Date(wi.endAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Blocked Times / Exceptions */}
                        {day.blockedIntervals.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium uppercase flex items-center gap-1">
                              <Lock className="h-3 w-3" /> Блокировки:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {day.blockedIntervals.map((bi, i) => (
                                <span
                                  key={i}
                                  className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded text-[11px] font-mono"
                                >
                                  {new Date(bi.startAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                  —
                                  {new Date(bi.endAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Occupied Appointments */}
                        {day.occupiedIntervals.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-700 dark:text-slate-300 font-medium uppercase">
                              Занято (записи):
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {day.occupiedIntervals.map((oi, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => {
                                    const apptId = (oi as any).appointmentId || (oi as any).id;
                                    if (apptId) handleOpenAppointmentDetails(apptId);
                                  }}
                                  className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors text-left cursor-pointer"
                                  title="Нажмите для просмотра деталей записи"
                                >
                                  {new Date(oi.startAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                  —
                                  {new Date(oi.endAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Available Slots */}
                        <div className="pt-2 border-t border-border/40 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold uppercase">
                              Свободные слоты ({durationMinutes}м):
                            </span>
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                              {day.availableSlots.length}
                            </span>
                          </div>

                          {day.availableSlots.length === 0 ? (
                            <p className="text-[11px] text-textMuted italic">
                              Нет доступных окон
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto pr-0.5">
                              {day.availableSlots.map((slot, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() =>
                                    handleOpenCreateAppointment(
                                      masterItem.master.id,
                                      day.date,
                                      slot.localStartTime
                                    )
                                  }
                                  className="bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200 text-center py-0.5 px-1 rounded text-[11px] font-medium transition-colors cursor-pointer"
                                  title="Нажмите для записи на этот слот"
                                >
                                  {slot.localStartTime}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend & Advisory notice */}
      <div className="bg-muted/30 border rounded-xl p-4 text-xs text-textMuted flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 dark:bg-emerald-950 dark:border-emerald-700" />
            <span>Свободный слот</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 dark:bg-amber-950 dark:border-amber-700" />
            <span>Блокировка / Выходной</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-200 border border-slate-300 dark:bg-slate-800 dark:border-slate-700" />
            <span>Занято записью</span>
          </div>
        </div>

        <p className="italic text-[11px]">
          * Доступность слотов рассчитывается в реальном времени. Фиксация времени
          выполняется при подтверждении записи.
        </p>
      </div>

      {/* Exceptions Modal */}
      <CalendarExceptionsDialog
        open={exceptionDialogOpen}
        onOpenChange={setExceptionDialogOpen}
        timezone={timezone}
        masters={allMasters}
        defaultDate={currentDate}
        defaultMasterId={selectedMasterId !== "all" ? selectedMasterId : undefined}
        onSuccess={() =>
          loadCalendar(currentDate, viewMode, selectedMasterId, durationMinutes)
        }
      />

      {/* Create Appointment Modal */}
      <AppointmentDialog
        open={bookingDialogOpen}
        onOpenChange={setBookingDialogOpen}
        timezone={timezone}
        defaultMasterId={bookingDialogParams.masterId}
        defaultDate={bookingDialogParams.date}
        defaultTime={bookingDialogParams.time}
        onSuccess={() =>
          loadCalendar(currentDate, viewMode, selectedMasterId, durationMinutes)
        }
      />

      {/* Appointment Details & Actions Modal */}
      <AppointmentDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        appointmentId={selectedAppointmentId}
        timezone={timezone}
        onSuccess={() =>
          loadCalendar(currentDate, viewMode, selectedMasterId, durationMinutes)
        }
      />
    </div>
  );
}
