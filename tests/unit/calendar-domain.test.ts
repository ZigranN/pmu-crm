import { describe, expect, it } from "vitest";
import {
  resolveDayAvailability,
} from "../../src/features/calendar/domain/availability";
import {
  getDayBoundsInUtc,
  parseLocalTimeToUtc,
  formatUtcToLocal,
  normalizeTimezone,
} from "../../src/features/calendar/domain/timezone";
import type { CalendarException, WorkingInterval } from "../../src/features/calendar/domain/types";

describe("Timezone Domain Engine", () => {
  it("normalizes timezone safely", () => {
    expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimezone("Asia/Bishkek")).toBe("Asia/Bishkek");
    expect(normalizeTimezone(null)).toBe("UTC");
    expect(normalizeTimezone("Invalid/Zone")).toBe("UTC");
  });

  it("converts local date and time to UTC and back deterministically", () => {
    const tz = "America/New_York";
    // 2026-06-15 is in EDT (UTC-4)
    const utcDate = parseLocalTimeToUtc("2026-06-15", "10:30", tz);
    expect(utcDate.toISOString()).toBe("2026-06-15T14:30:00.000Z");

    const local = formatUtcToLocal(utcDate, tz);
    expect(local.dateString).toBe("2026-06-15");
    expect(local.timeString).toBe("10:30");
    expect(local.weekday).toBe(1); // Monday
  });

  it("handles DST spring-forward (23-hour day)", () => {
    const tz = "America/New_York";
    // In US, spring forward is on 2026-03-08 (at 2am clock jumps to 3am)
    const bounds = getDayBoundsInUtc("2026-03-08", tz);
    // Start of day is 2026-03-08 00:00 EST -> 05:00 UTC
    expect(bounds.startOfDay.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // Next day start is 2026-03-09 00:00 EDT -> 04:00 UTC
    expect(bounds.nextDayStart.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    // Difference is exactly 23 hours
    const durationHours = (bounds.nextDayStart.getTime() - bounds.startOfDay.getTime()) / (3600 * 1000);
    expect(durationHours).toBe(23);
  });

  it("handles DST fall-back (25-hour day)", () => {
    const tz = "America/New_York";
    // In US, fall back is on 2026-11-01 (at 2am clock repeats 1am)
    const bounds = getDayBoundsInUtc("2026-11-01", tz);
    // Start of day is 2026-11-01 00:00 EDT -> 04:00 UTC
    expect(bounds.startOfDay.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // Next day start is 2026-11-02 00:00 EST -> 05:00 UTC
    expect(bounds.nextDayStart.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Difference is exactly 25 hours
    const durationHours = (bounds.nextDayStart.getTime() - bounds.startOfDay.getTime()) / (3600 * 1000);
    expect(durationHours).toBe(25);
  });

  it("handles cross-midnight UTC boundary conversion in Asia/Bishkek (UTC+6)", () => {
    const tz = "Asia/Bishkek";
    // 2026-05-10 09:00 in Bishkek is 2026-05-10 03:00 UTC
    const utcDate = parseLocalTimeToUtc("2026-05-10", "09:00", tz);
    expect(utcDate.toISOString()).toBe("2026-05-10T03:00:00.000Z");

    // 2026-05-10 02:00 in Bishkek is 2026-05-09 20:00 UTC (previous calendar date in UTC)
    const earlyUtc = parseLocalTimeToUtc("2026-05-10", "02:00", tz);
    expect(earlyUtc.toISOString()).toBe("2026-05-09T20:00:00.000Z");
    const formatted = formatUtcToLocal(earlyUtc, tz);
    expect(formatted.dateString).toBe("2026-05-10");
    expect(formatted.timeString).toBe("02:00");
  });
});

describe("Pure Availability Engine", () => {
  const tz = "Europe/Rome"; // UTC+2 in summer, UTC+1 in winter

  it("1. Master with no working hours has no availability", () => {
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12", // Tuesday (weekday 2)
      workingHours: [],
    });
    expect(res.isWorkingDay).toBe(false);
    expect(res.workingIntervals).toHaveLength(0);
    expect(res.availableIntervals).toHaveLength(0);
    expect(res.availableSlots).toHaveLength(0);
  });

  it("2. One daily interval produces full working availability and slots", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12", // Tuesday (weekday 2)
      workingHours,
      slotDurationMinutes: 60,
    });
    expect(res.isWorkingDay).toBe(true);
    expect(res.workingIntervals).toHaveLength(1);
    expect(res.availableIntervals).toHaveLength(1);
    // 09:00 to 18:00 with 60 min slots = 9 slots (09:00, 10:00, ..., 17:00)
    expect(res.availableSlots).toHaveLength(9);
    expect(res.availableSlots[0].localStartTime).toBe("09:00");
    expect(res.availableSlots[0].localEndTime).toBe("10:00");
    expect(res.availableSlots[8].localStartTime).toBe("17:00");
    expect(res.availableSlots[8].localEndTime).toBe("18:00");
  });

  it("3. Multiple working intervals on same day", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "13:00", isActive: true },
      { weekday: 2, startTime: "14:00", endTime: "18:00", isActive: true },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      slotDurationMinutes: 60,
    });
    expect(res.workingIntervals).toHaveLength(2);
    expect(res.availableIntervals).toHaveLength(2);
    // 4 slots in morning + 4 slots in afternoon = 8 slots
    expect(res.availableSlots).toHaveLength(8);
    expect(res.availableSlots[3].localStartTime).toBe("12:00");
    expect(res.availableSlots[3].localEndTime).toBe("13:00");
    expect(res.availableSlots[4].localStartTime).toBe("14:00");
    expect(res.availableSlots[4].localEndTime).toBe("15:00");
  });

  it("4. Invalid start/end rejected or ignored", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "18:00", endTime: "09:00", isActive: true }, // Invalid start > end
      { weekday: 2, startTime: "10:00", endTime: "10:00", isActive: true }, // Invalid start === end
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
    });
    expect(res.workingIntervals).toHaveLength(0);
    expect(res.availableSlots).toHaveLength(0);
  });

  it("6. Overlapping working intervals are merged", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "14:00", isActive: true },
      { weekday: 2, startTime: "12:00", endTime: "18:00", isActive: true },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      slotDurationMinutes: 60,
    });
    expect(res.workingIntervals).toHaveLength(1);
    expect(res.availableSlots).toHaveLength(9); // 09:00 to 18:00 continuous
  });

  it("7. Full day off clears all availability", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const bounds = getDayBoundsInUtc("2026-05-12", tz);
    const exceptions: CalendarException[] = [
      {
        type: "DAY_OFF",
        startAt: bounds.startOfDay,
        endAt: bounds.nextDayStart,
        reason: "Sick leave",
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
    });
    expect(res.isWorkingDay).toBe(true);
    expect(res.availableIntervals).toHaveLength(0);
    expect(res.availableSlots).toHaveLength(0);
    expect(res.blockedIntervals).toHaveLength(1);
  });

  it("8. Partial blocked time reduces availability", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    // Block lunch from 12:00 to 13:00 local time
    const blockStart = parseLocalTimeToUtc("2026-05-12", "12:00", tz);
    const blockEnd = parseLocalTimeToUtc("2026-05-12", "13:00", tz);
    const exceptions: CalendarException[] = [
      {
        type: "BLOCKED_TIME",
        startAt: blockStart,
        endAt: blockEnd,
        reason: "Lunch break",
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
      slotDurationMinutes: 60,
    });
    expect(res.availableIntervals).toHaveLength(2);
    expect(res.availableSlots).toHaveLength(8);
    // Ensure no slot overlaps 12:00-13:00
    for (const slot of res.availableSlots) {
      expect(slot.localStartTime !== "12:00").toBe(true);
    }
  });

  it("9. Overlapping blocks merged cleanly", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const exceptions: CalendarException[] = [
      {
        type: "BLOCKED_TIME",
        startAt: parseLocalTimeToUtc("2026-05-12", "12:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "13:30", tz),
      },
      {
        type: "BLOCKED_TIME",
        startAt: parseLocalTimeToUtc("2026-05-12", "13:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "14:00", tz),
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
      slotDurationMinutes: 60,
    });
    expect(res.blockedIntervals).toHaveLength(1);
    expect(res.availableIntervals).toHaveLength(2);
  });

  it("10. Studio-wide closure subtracts availability from all masters", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const exceptions: CalendarException[] = [
      {
        masterId: null, // Studio closure
        type: "STUDIO_CLOSURE",
        startAt: parseLocalTimeToUtc("2026-05-12", "15:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "18:00", tz),
        reason: "Studio renovation",
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
      slotDurationMinutes: 60,
    });
    expect(res.availableIntervals).toHaveLength(1);
    // Available from 09:00 to 15:00 -> 6 slots
    expect(res.availableSlots).toHaveLength(6);
    expect(res.availableSlots[5].localStartTime).toBe("14:00");
    expect(res.availableSlots[5].localEndTime).toBe("15:00");
  });

  it("11. Block outside working hours has zero effect on availability", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const exceptions: CalendarException[] = [
      {
        type: "BLOCKED_TIME",
        startAt: parseLocalTimeToUtc("2026-05-12", "06:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "08:00", tz),
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
      slotDurationMinutes: 60,
    });
    expect(res.availableSlots).toHaveLength(9);
  });

  it("13, 14, 15. Busy interval subtraction and adjacent boundary touching", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    // Busy appointment: 10:00 to 11:30
    const occupiedIntervals = [
      {
        startAt: parseLocalTimeToUtc("2026-05-12", "10:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "11:30", tz),
        title: "Microblading",
      },
    ];
    const res = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      occupiedIntervals,
      slotDurationMinutes: 60,
      slotStepMinutes: 30, // 30 min step
    });

    // 09:00-10:00 is available (1 slot: 09:00-10:00)
    // 10:00-11:30 is busy
    // 11:30-18:00 is available (11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00)
    expect(res.availableSlots.some((s) => s.localStartTime === "09:00")).toBe(true);
    expect(res.availableSlots.some((s) => s.localStartTime === "09:30")).toBe(false); // 09:30+60=10:30 overlaps busy
    expect(res.availableSlots.some((s) => s.localStartTime === "10:00")).toBe(false);
    expect(res.availableSlots.some((s) => s.localStartTime === "11:00")).toBe(false);
    expect(res.availableSlots.some((s) => s.localStartTime === "11:30")).toBe(true); // adjacent boundary starting immediately at 11:30
  });

  it("16, 17. Slot duration fitting and omission of non-fitting intervals", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "10:00", isActive: true }, // 60 min window
    ];
    const res60 = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      slotDurationMinutes: 60,
    });
    expect(res60.availableSlots).toHaveLength(1);

    const res90 = resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      slotDurationMinutes: 90, // does not fit
    });
    expect(res90.availableSlots).toHaveLength(0);
  });

  it("10. Input immutability check", () => {
    const workingHours: WorkingInterval[] = [
      { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
    ];
    const exceptions: CalendarException[] = [
      {
        type: "BLOCKED_TIME",
        startAt: parseLocalTimeToUtc("2026-05-12", "12:00", tz),
        endAt: parseLocalTimeToUtc("2026-05-12", "13:00", tz),
      },
    ];
    const whClone = JSON.stringify(workingHours);
    const excClone = JSON.stringify(exceptions);

    resolveDayAvailability({
      timezone: tz,
      date: "2026-05-12",
      workingHours,
      exceptions,
    });

    expect(JSON.stringify(workingHours)).toBe(whClone);
    expect(JSON.stringify(exceptions)).toBe(excClone);
  });
});
