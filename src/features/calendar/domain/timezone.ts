/**
 * Pure timezone manipulation domain functions.
 * No DB/server/framework dependencies.
 */

export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  dateString: string; // "YYYY-MM-DD"
  timeString: string; // "HH:mm"
}

/**
 * Validates whether a timezone identifier is valid IANA timezone.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes timezone, falling back to UTC if invalid.
 */
export function normalizeTimezone(timezone?: string | null): string {
  if (!timezone) return "UTC";
  const trimmed = timezone.trim();
  return isValidTimezone(trimmed) ? trimmed : "UTC";
}

/**
 * Formats a UTC Date into local components for a specified timezone.
 */
export function formatUtcToLocal(date: Date, timezone: string): LocalTimeParts {
  const tz = normalizeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekdayStr = "Sun";

  for (const part of parts) {
    if (part.type === "year") year = parseInt(part.value, 10);
    else if (part.type === "month") month = parseInt(part.value, 10);
    else if (part.type === "day") day = parseInt(part.value, 10);
    else if (part.type === "hour") {
      hour = parseInt(part.value, 10);
      if (hour === 24) hour = 0; // Fix edge case in some ICU versions
    } else if (part.type === "minute") minute = parseInt(part.value, 10);
    else if (part.type === "second") second = parseInt(part.value, 10);
    else if (part.type === "weekday") weekdayStr = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;

  const pad = (n: number) => String(n).padStart(2, "0");
  const dateString = `${year}-${pad(month)}-${pad(day)}`;
  const timeString = `${pad(hour)}:${pad(minute)}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday,
    dateString,
    timeString,
  };
}

/**
 * Converts a local date ("YYYY-MM-DD") and local time ("HH:mm" or "HH:mm:ss")
 * in the given timezone into an exact UTC Date instant.
 * Handles DST spring-forward and fall-back boundaries accurately.
 */
export function parseLocalTimeToUtc(
  localDateStr: string,
  localTimeStr: string,
  timezone: string
): Date {
  const tz = normalizeTimezone(timezone);
  const [yearStr, monthStr, dayStr] = localDateStr.split("-");
  const [hourStr, minStr, secStr] = localTimeStr.split(":");

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr || "0", 10);
  const minute = parseInt(minStr || "0", 10);
  const second = parseInt(secStr || "0", 10);

  // Initial approximation in UTC
  let targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Iteratively converge to resolve local time in target timezone
  for (let i = 0; i < 3; i++) {
    const local = formatUtcToLocal(new Date(targetUtcMs), tz);
    const localMs = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    const expectedMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = expectedMs - localMs;

    if (diff === 0) {
      break;
    }
    targetUtcMs += diff;
  }

  return new Date(targetUtcMs);
}

/**
 * Gets the UTC start and end bounds for a given Studio-local date ("YYYY-MM-DD").
 */
export function getDayBoundsInUtc(
  localDateStr: string,
  timezone: string
): { startOfDay: Date; endOfDay: Date; nextDayStart: Date; weekday: number } {
  const tz = normalizeTimezone(timezone);
  const startOfDay = parseLocalTimeToUtc(localDateStr, "00:00:00", tz);

  // Next day start
  const [y, m, d] = localDateStr.split("-").map((v) => parseInt(v, 10));
  const nextDateObj = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextDateStr = `${nextDateObj.getUTCFullYear()}-${pad(
    nextDateObj.getUTCMonth() + 1
  )}-${pad(nextDateObj.getUTCDate())}`;

  const nextDayStart = parseLocalTimeToUtc(nextDateStr, "00:00:00", tz);
  const endOfDay = new Date(nextDayStart.getTime() - 1);

  const local = formatUtcToLocal(startOfDay, tz);
  return {
    startOfDay,
    endOfDay,
    nextDayStart,
    weekday: local.weekday,
  };
}

/**
 * Formats a local Date string "YYYY-MM-DD" + offset days.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

/**
 * Generates an array of date strings between startDate and endDate (inclusive).
 */
export function getDateRangeList(startDateStr: string, endDateStr: string): string[] {
  const list: string[] = [];
  let current = startDateStr;
  while (current <= endDateStr) {
    list.push(current);
    current = addDaysToDateString(current, 1);
  }
  return list;
}

/**
 * Gets the week dates (Monday to Sunday) for a given date in format YYYY-MM-DD.
 */
export function getWeekDates(dateStr: string, timezone: string): { startDate: string; endDate: string; dates: string[] } {
  const bounds = getDayBoundsInUtc(dateStr, timezone);
  // Weekday: 0=Sun, 1=Mon, ..., 6=Sat
  // We want Monday (1) to Sunday (0)
  const dayOffsetFromMonday = (bounds.weekday + 6) % 7; // Mon -> 0, Tue -> 1, ..., Sun -> 6
  const mondayDateStr = addDaysToDateString(dateStr, -dayOffsetFromMonday);
  const sundayDateStr = addDaysToDateString(mondayDateStr, 6);
  const dates = getDateRangeList(mondayDateStr, sundayDateStr);

  return {
    startDate: mondayDateStr,
    endDate: sundayDateStr,
    dates,
  };
}
