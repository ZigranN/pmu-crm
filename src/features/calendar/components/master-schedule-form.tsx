"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Clock, Check, AlertCircle } from "lucide-react";
import { setMasterWorkingHoursAction } from "../server/actions";
import { type WorkingInterval } from "../domain/types";

interface MasterScheduleFormProps {
  masterId: string;
  initialWorkingHours: WorkingInterval[];
  canEdit?: boolean;
}

const WEEKDAYS = [
  { index: 1, label: "Понедельник", short: "Пн" },
  { index: 2, label: "Вторник", short: "Вт" },
  { index: 3, label: "Среда", short: "Ср" },
  { index: 4, label: "Четверг", short: "Чт" },
  { index: 5, label: "Пятница", short: "Пт" },
  { index: 6, label: "Суббота", short: "Сб" },
  { index: 0, label: "Воскресенье", short: "Вс" },
];

interface DayScheduleState {
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

export function MasterScheduleForm({
  masterId,
  initialWorkingHours,
  canEdit = true,
}: MasterScheduleFormProps) {
  // Build initial state for each day 0-6
  const getInitialState = (): Record<number, DayScheduleState> => {
    const state: Record<number, DayScheduleState> = {};
    for (const wd of WEEKDAYS) {
      const matching = initialWorkingHours.filter(
        (wh) => wh.weekday === wd.index && wh.isActive !== false
      );
      if (matching.length > 0) {
        state[wd.index] = {
          enabled: true,
          intervals: matching.map((m) => ({
            startTime: m.startTime,
            endTime: m.endTime,
          })),
        };
      } else {
        state[wd.index] = {
          enabled: false,
          intervals: [{ startTime: "09:00", endTime: "18:00" }],
        };
      }
    }
    return state;
  };

  const [schedule, setSchedule] = useState<Record<number, DayScheduleState>>(getInitialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleToggleDay = (weekday: number, enabled: boolean) => {
    setSchedule((prev) => ({
      ...prev,
      [weekday]: {
        ...prev[weekday],
        enabled,
      },
    }));
    setSuccess(false);
  };

  const handleIntervalChange = (
    weekday: number,
    idx: number,
    field: "startTime" | "endTime",
    value: string
  ) => {
    setSchedule((prev) => {
      const nextIntervals = [...prev[weekday].intervals];
      nextIntervals[idx] = {
        ...nextIntervals[idx],
        [field]: value,
      };
      return {
        ...prev,
        [weekday]: {
          ...prev[weekday],
          intervals: nextIntervals,
        },
      };
    });
    setSuccess(false);
  };

  const handleAddInterval = (weekday: number) => {
    setSchedule((prev) => {
      const current = prev[weekday].intervals;
      const last = current[current.length - 1];
      let newStart = "14:00";
      let newEnd = "18:00";
      if (last) {
        newStart = last.endTime;
        newEnd = "19:00";
      }
      return {
        ...prev,
        [weekday]: {
          ...prev[weekday],
          intervals: [...current, { startTime: newStart, endTime: newEnd }],
        },
      };
    });
    setSuccess(false);
  };

  const handleRemoveInterval = (weekday: number, idx: number) => {
    setSchedule((prev) => {
      const nextIntervals = prev[weekday].intervals.filter((_, i) => i !== idx);
      return {
        ...prev,
        [weekday]: {
          ...prev[weekday],
          intervals: nextIntervals.length > 0 ? nextIntervals : [{ startTime: "09:00", endTime: "18:00" }],
          enabled: nextIntervals.length > 0 ? prev[weekday].enabled : false,
        },
      };
    });
    setSuccess(false);
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const intervalsToSave: Array<{
        weekday: number;
        startTime: string;
        endTime: string;
        isActive: boolean;
      }> = [];

      for (const wd of WEEKDAYS) {
        const dayState = schedule[wd.index];
        if (dayState.enabled) {
          for (const interval of dayState.intervals) {
            intervalsToSave.push({
              weekday: wd.index,
              startTime: interval.startTime,
              endTime: interval.endTime,
              isActive: true,
            });
          }
        }
      }

      await setMasterWorkingHoursAction({
        masterId,
        intervals: intervalsToSave,
        reason: "Обновление постоянного графика мастера",
      });

      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Ошибка при сохранении расписания");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-taupe" />
          Постоянный рабочий график
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="p-3 text-sm flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-950/50 rounded-md">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3 text-sm flex items-center gap-2 text-green-700 bg-green-50 dark:bg-green-950/50 rounded-md">
            <Check className="h-4 w-4 shrink-0" />
            <span>График успешно сохранен!</span>
          </div>
        )}

        <div className="space-y-4 divide-y divide-border/50">
          {WEEKDAYS.map((wd) => {
            const dayState = schedule[wd.index];
            return (
              <div key={wd.index} className="pt-4 first:pt-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={dayState.enabled}
                      onCheckedChange={(val) => handleToggleDay(wd.index, val)}
                      disabled={!canEdit || loading}
                      id={`switch-${wd.index}`}
                    />
                    <label
                      htmlFor={`switch-${wd.index}`}
                      className="font-medium text-sm cursor-pointer select-none"
                    >
                      {wd.label}
                    </label>
                  </div>

                  {dayState.enabled ? (
                    <div className="flex flex-col gap-2 flex-1 sm:max-w-md">
                      {dayState.intervals.map((interval, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={interval.startTime}
                            onChange={(e) =>
                              handleIntervalChange(
                                wd.index,
                                idx,
                                "startTime",
                                e.target.value
                              )
                            }
                            disabled={!canEdit || loading}
                            className="w-28 text-center"
                          />
                          <span className="text-textMuted">—</span>
                          <Input
                            type="time"
                            value={interval.endTime}
                            onChange={(e) =>
                              handleIntervalChange(
                                wd.index,
                                idx,
                                "endTime",
                                e.target.value
                              )
                            }
                            disabled={!canEdit || loading}
                            className="w-28 text-center"
                          />
                          {canEdit && dayState.intervals.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              onClick={() => handleRemoveInterval(wd.index, idx)}
                              disabled={loading}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}

                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-fit text-xs text-taupe hover:text-taupe/80 h-7 px-2"
                          onClick={() => handleAddInterval(wd.index)}
                          disabled={loading}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Добавить интервал
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-textMuted italic">Выходной</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {canEdit && (
          <div className="pt-4 border-t flex justify-end">
            <Button onClick={handleSave} disabled={loading} className="min-w-32">
              {loading ? "Сохранение..." : "Сохранить график"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
