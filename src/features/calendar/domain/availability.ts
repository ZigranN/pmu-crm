/**
 * Pure Availability & Calendar Engine.
 * Zero database, auth, or framework dependencies.
 * Deterministic and immutable.
 */

import {
  type CalendarRangeResolutionInput,
  type CalendarResolutionInput,
  type MasterDayAvailability,
  type TimeInterval,
  type TimeSlot,
  type WorkingInterval,
} from "./types";
import {
  formatUtcToLocal,
  getDayBoundsInUtc,
  getDateRangeList,
  normalizeTimezone,
  parseLocalTimeToUtc,
} from "./timezone";

/**
 * Validates and converts time strings "HH:mm" to minutes from midnight (0..1439).
 */
export function timeStringToMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: "${timeStr}". Expected "HH:mm" (00:00 - 23:59).`);
  }
  return h * 60 + m;
}

/**
 * Merges overlapping or adjacent time intervals.
 * Returns a sorted, non-overlapping array of intervals.
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];

  // Sort by startAt ascending, then endAt ascending
  const sorted = [...intervals]
    .filter((i) => i.endAt.getTime() > i.startAt.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  if (sorted.length === 0) return [];

  const merged: TimeInterval[] = [{
    startAt: new Date(sorted[0].startAt.getTime()),
    endAt: new Date(sorted[0].endAt.getTime()),
  }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startAt.getTime() <= last.endAt.getTime()) {
      // Overlapping or touching intervals
      if (current.endAt.getTime() > last.endAt.getTime()) {
        last.endAt = new Date(current.endAt.getTime());
      }
    } else {
      merged.push({
        startAt: new Date(current.startAt.getTime()),
        endAt: new Date(current.endAt.getTime()),
      });
    }
  }

  return merged;
}

/**
 * Subtracts busy/blocked intervals from source intervals.
 * Handles partial overlaps, complete containment, and multiple sub-slices.
 */
export function subtractIntervals(
  sourceIntervals: TimeInterval[],
  busyIntervals: TimeInterval[]
): TimeInterval[] {
  if (sourceIntervals.length === 0) return [];
  if (busyIntervals.length === 0) return mergeIntervals(sourceIntervals);

  const mergedSources = mergeIntervals(sourceIntervals);
  const mergedBusy = mergeIntervals(busyIntervals);

  const available: TimeInterval[] = [];

  for (const src of mergedSources) {
    let currentStart = src.startAt.getTime();
    const srcEnd = src.endAt.getTime();

    for (const busy of mergedBusy) {
      const busyStart = busy.startAt.getTime();
      const busyEnd = busy.endAt.getTime();

      if (busyEnd <= currentStart) {
        // Busy interval is completely before current point
        continue;
      }
      if (busyStart >= srcEnd) {
        // Busy interval is completely after source interval
        break;
      }

      if (busyStart > currentStart) {
        // There is available time between currentStart and busyStart
        available.push({
          startAt: new Date(currentStart),
          endAt: new Date(Math.min(busyStart, srcEnd)),
        });
      }

      // Move currentStart forward past the busy interval
      currentStart = Math.max(currentStart, busyEnd);
      if (currentStart >= srcEnd) {
        break;
      }
    }

    if (currentStart < srcEnd) {
      available.push({
        startAt: new Date(currentStart),
        endAt: new Date(srcEnd),
      });
    }
  }

  return available.filter((i) => i.endAt.getTime() > i.startAt.getTime());
}

/**
 * Clips an interval to a given bounding window [windowStart, windowEnd].
 * Returns null if no intersection.
 */
export function clipIntervalToWindow(
  interval: TimeInterval,
  windowStart: Date,
  windowEnd: Date
): TimeInterval | null {
  const start = Math.max(interval.startAt.getTime(), windowStart.getTime());
  const end = Math.min(interval.endAt.getTime(), windowEnd.getTime());

  if (start < end) {
    return {
      startAt: new Date(start),
      endAt: new Date(end),
    };
  }
  return null;
}

/**
 * Normalizes working hours for a given day and master:
 * - Filters for matching weekday and isActive !== false
 * - Validates start < end
 * - Converts local time strings to UTC instants on the specific calendar date
 * - Merges overlapping intervals
 */
export function resolveWorkingIntervalsForDay(
  workingHours: WorkingInterval[],
  dateStr: string,
  weekday: number,
  timezone: string
): TimeInterval[] {
  const tz = normalizeTimezone(timezone);
  const matching = workingHours.filter(
    (wh) => wh.weekday === weekday && wh.isActive !== false
  );

  const rawIntervals: TimeInterval[] = [];
  for (const wh of matching) {
    try {
      const startMin = timeStringToMinutes(wh.startTime);
      const endMin = timeStringToMinutes(wh.endTime);
      if (startMin >= endMin) {
        // start >= end is invalid, skip or reject
        continue;
      }

      const startAt = parseLocalTimeToUtc(dateStr, wh.startTime, tz);
      const endAt = parseLocalTimeToUtc(dateStr, wh.endTime, tz);

      if (endAt.getTime() > startAt.getTime()) {
        rawIntervals.push({ startAt, endAt });
      }
    } catch {
      // Invalid time format, skip
      continue;
    }
  }

  return mergeIntervals(rawIntervals);
}

/**
 * Generates discrete time slots from available continuous intervals.
 */
export function generateSlots(
  availableIntervals: TimeInterval[],
  slotDurationMinutes: number,
  slotStepMinutes: number | undefined,
  timezone: string,
  dateStr: string
): TimeSlot[] {
  if (slotDurationMinutes <= 0 || availableIntervals.length === 0) {
    return [];
  }

  const tz = normalizeTimezone(timezone);
  const stepMinutes = slotStepMinutes && slotStepMinutes > 0 ? slotStepMinutes : slotDurationMinutes;
  const stepMs = stepMinutes * 60 * 1000;
  const durationMs = slotDurationMinutes * 60 * 1000;

  const slots: TimeSlot[] = [];
  const seenStartTimes = new Set<number>();

  for (const interval of availableIntervals) {
    let currentStartMs = interval.startAt.getTime();
    const intervalEndMs = interval.endAt.getTime();

    while (currentStartMs + durationMs <= intervalEndMs) {
      if (!seenStartTimes.has(currentStartMs)) {
        seenStartTimes.add(currentStartMs);
        const slotStart = new Date(currentStartMs);
        const slotEnd = new Date(currentStartMs + durationMs);

        const startLocal = formatUtcToLocal(slotStart, tz);
        const endLocal = formatUtcToLocal(slotEnd, tz);

        slots.push({
          startAt: slotStart,
          endAt: slotEnd,
          localDate: dateStr,
          localStartTime: startLocal.timeString,
          localEndTime: endLocal.timeString,
        });
      }

      currentStartMs += stepMs;
    }
  }

  // Ensure deterministic sort by startAt
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Resolves availability for a single day for a master in a studio.
 */
export function resolveDayAvailability(
  input: CalendarResolutionInput
): MasterDayAvailability {
  const {
    timezone,
    date,
    workingHours,
    exceptions = [],
    occupiedIntervals = [],
    slotDurationMinutes = 60,
    slotStepMinutes,
  } = input;

  const tz = normalizeTimezone(timezone);
  const bounds = getDayBoundsInUtc(date, tz);
  const { startOfDay, nextDayStart, weekday } = bounds;

  // 1. Resolve master working intervals for this weekday
  const workingIntervals = resolveWorkingIntervalsForDay(
    workingHours,
    date,
    weekday,
    tz
  );

  // If no working hours, day is non-working and has no availability
  if (workingIntervals.length === 0) {
    return {
      date,
      weekday,
      isWorkingDay: false,
      timezone: tz,
      workingIntervals: [],
      blockedIntervals: [],
      occupiedIntervals: [],
      availableIntervals: [],
      availableSlots: [],
    };
  }

  // 2. Process Calendar Exceptions (DAY_OFF, BLOCKED_TIME, STUDIO_CLOSURE)
  const clippedBlockedIntervals: TimeInterval[] = [];
  let isFullDayOff = false;

  for (const exc of exceptions) {
    const clipped = clipIntervalToWindow(
      { startAt: exc.startAt, endAt: exc.endAt },
      startOfDay,
      nextDayStart
    );
    if (!clipped) continue;

    if (exc.type === "DAY_OFF") {
      // If day off spans the whole working day or entire day
      // Check if it intersects all working intervals
      const remainingWork = subtractIntervals(workingIntervals, [clipped]);
      if (remainingWork.length === 0) {
        isFullDayOff = true;
      }
      clippedBlockedIntervals.push(clipped);
    } else {
      // BLOCKED_TIME or STUDIO_CLOSURE
      clippedBlockedIntervals.push(clipped);
    }
  }

  // If full day off, return empty available slots
  if (isFullDayOff) {
    const mergedBlocks = mergeIntervals(clippedBlockedIntervals);
    return {
      date,
      weekday,
      isWorkingDay: true,
      timezone: tz,
      workingIntervals,
      blockedIntervals: mergedBlocks,
      occupiedIntervals: [],
      availableIntervals: [],
      availableSlots: [],
    };
  }

  // 3. Process Occupied Intervals (Appointments / Procedure Sessions)
  const clippedOccupiedIntervals: TimeInterval[] = [];
  for (const occ of occupiedIntervals) {
    const clipped = clipIntervalToWindow(
      { startAt: occ.startAt, endAt: occ.endAt },
      startOfDay,
      nextDayStart
    );
    if (clipped) {
      clippedOccupiedIntervals.push(clipped);
    }
  }

  // 4. Combine all busy periods and subtract from working hours
  const allBusy = mergeIntervals([
    ...clippedBlockedIntervals,
    ...clippedOccupiedIntervals,
  ]);

  const availableIntervals = subtractIntervals(workingIntervals, allBusy);

  // 5. Generate discrete available slots
  const availableSlots = generateSlots(
    availableIntervals,
    slotDurationMinutes,
    slotStepMinutes,
    tz,
    date
  );

  return {
    date,
    weekday,
    isWorkingDay: true,
    timezone: tz,
    workingIntervals,
    blockedIntervals: mergeIntervals(clippedBlockedIntervals),
    occupiedIntervals: mergeIntervals(clippedOccupiedIntervals),
    availableIntervals,
    availableSlots,
  };
}

/**
 * Resolves availability across a date range (e.g. week or month).
 */
export function resolveRangeAvailability(
  input: CalendarRangeResolutionInput
): MasterDayAvailability[] {
  const {
    timezone,
    startDate,
    endDate,
    workingHours,
    exceptions = [],
    occupiedIntervals = [],
    slotDurationMinutes = 60,
    slotStepMinutes,
  } = input;

  const dates = getDateRangeList(startDate, endDate);
  const result: MasterDayAvailability[] = [];

  for (const date of dates) {
    const dayResult = resolveDayAvailability({
      timezone,
      date,
      workingHours,
      exceptions,
      occupiedIntervals,
      slotDurationMinutes,
      slotStepMinutes,
    });
    result.push(dayResult);
  }

  return result;
}
