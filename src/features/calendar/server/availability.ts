import "server-only";
import { db } from "@/db";
import {
  appointments,
  calendarExceptions,
  masterAvailability,
  masters,
  studios,
} from "@/db/schema";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { resourceScope } from "@/server/auth/scopes";
import type { Transaction } from "@/server/commands/ownership";
import {
  type CalendarException,
  type MasterDayAvailability,
  type OccupiedInterval,
  type WorkingInterval,
} from "../domain/types";
import {
  getDayBoundsInUtc,
  getDateRangeList,
  normalizeTimezone,
} from "../domain/timezone";
import {
  resolveDayAvailability,
  resolveRangeAvailability,
} from "../domain/availability";
import { z } from "zod";

export interface MasterAvailabilityOptions {
  masterId: string;
  date: string; // "YYYY-MM-DD"
  durationMinutes?: number;
  slotStepMinutes?: number;
}

export interface MasterRangeAvailabilityOptions {
  masterId: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  durationMinutes?: number;
  slotStepMinutes?: number;
}

export interface StudioCalendarViewOptions {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  masterId?: string;
  durationMinutes?: number;
}

export interface MasterCalendarViewModel {
  master: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
  };
  days: MasterDayAvailability[];
}

export interface StudioCalendarViewModel {
  studioId: string;
  timezone: string;
  startDate: string;
  endDate: string;
  dates: string[];
  studioClosures: CalendarException[];
  masters: MasterCalendarViewModel[];
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PostgreSQL-backed read resolver for single-day Master availability.
 * Read-only: executes zero write/mutation queries.
 */
export async function getMasterAvailability(
  context: { studioId: string; userId: string },
  options: MasterAvailabilityOptions,
  executor: typeof db | Transaction = db
): Promise<MasterDayAvailability> {
  const { masterId, date, durationMinutes = 60, slotStepMinutes } = options;

  z.string().uuid().parse(context.studioId);
  z.string().uuid().parse(masterId);
  if (!dateRegex.test(date)) {
    throw new Error(`Invalid date format: "${date}". Expected "YYYY-MM-DD".`);
  }

  // 1. Authorize actor and tenant scope
  const scope = await resourceScope(context, executor);

  // 2. Fetch master and verify active & studio membership
  const [master] = await executor
    .select()
    .from(masters)
    .where(
      and(
        eq(masters.id, masterId),
        eq(masters.studioId, context.studioId),
        isNull(masters.deletedAt)
      )
    );

  if (!master) {
    throw new Error("Master not found");
  }

  // If actor is MASTER, they can only view their own availability if constrained
  if (scope.isMaster) {
    const isSelf = master.userId === context.userId;
    if (!isSelf) {
      throw new Error("Permission denied");
    }
  }

  // 3. Fetch studio timezone
  const [studio] = await executor
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, context.studioId));

  const timezone = normalizeTimezone(studio?.timezone);
  const dayBounds = getDayBoundsInUtc(date, timezone);

  // 4. Query Master Working Hours
  const workingHoursRows = await executor
    .select()
    .from(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, context.studioId),
        eq(masterAvailability.masterId, masterId),
        eq(masterAvailability.isActive, true)
      )
    );

  const workingHours: WorkingInterval[] = workingHoursRows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    isActive: r.isActive,
  }));

  // 5. Query Calendar Exceptions (Master-specific and Studio-wide)
  const exceptionsRows = await executor
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.studioId, context.studioId),
        or(
          eq(calendarExceptions.masterId, masterId),
          isNull(calendarExceptions.masterId)
        ),
        isNull(calendarExceptions.deletedAt),
        lt(calendarExceptions.startAt, dayBounds.nextDayStart),
        gt(calendarExceptions.endAt, dayBounds.startOfDay)
      )
    );

  const exceptions: CalendarException[] = exceptionsRows.map((r) => ({
    id: r.id,
    studioId: r.studioId,
    masterId: r.masterId,
    type: r.type as CalendarException["type"],
    reason: r.reason,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
  }));

  // 6. Query Occupied Appointments
  const appointmentRows = await executor
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.studioId, context.studioId),
        eq(appointments.masterId, masterId),
        ne(appointments.status, "cancelled"),
        isNull(appointments.deletedAt),
        lt(appointments.startAt, dayBounds.nextDayStart),
        gt(appointments.endAt, dayBounds.startOfDay)
      )
    );

  const occupiedIntervals: OccupiedInterval[] = appointmentRows.map((r) => ({
    id: r.id,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
    appointmentId: r.id,
    source: "appointment",
  }));

  // 7. Resolve via pure domain engine
  return resolveDayAvailability({
    timezone,
    date,
    workingHours,
    exceptions,
    occupiedIntervals,
    slotDurationMinutes: durationMinutes,
    slotStepMinutes,
  });
}

/**
 * PostgreSQL-backed read resolver for range Master availability.
 */
export async function getMasterAvailabilityRange(
  context: { studioId: string; userId: string },
  options: MasterRangeAvailabilityOptions,
  executor: typeof db | Transaction = db
): Promise<MasterDayAvailability[]> {
  const { masterId, startDate, endDate, durationMinutes = 60, slotStepMinutes } = options;

  z.string().uuid().parse(context.studioId);
  z.string().uuid().parse(masterId);
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    throw new Error("Invalid date range format. Expected 'YYYY-MM-DD'.");
  }

  const scope = await resourceScope(context, executor);

  const [master] = await executor
    .select()
    .from(masters)
    .where(
      and(
        eq(masters.id, masterId),
        eq(masters.studioId, context.studioId),
        isNull(masters.deletedAt)
      )
    );

  if (!master) {
    throw new Error("Master not found");
  }

  if (scope.isMaster && master.userId !== context.userId) {
    throw new Error("Permission denied");
  }

  const [studio] = await executor
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, context.studioId));

  const timezone = normalizeTimezone(studio?.timezone);
  const startBounds = getDayBoundsInUtc(startDate, timezone);
  const endBounds = getDayBoundsInUtc(endDate, timezone);

  const workingHoursRows = await executor
    .select()
    .from(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, context.studioId),
        eq(masterAvailability.masterId, masterId),
        eq(masterAvailability.isActive, true)
      )
    );

  const workingHours: WorkingInterval[] = workingHoursRows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startTime: r.startTime,
    endTime: r.endTime,
    isActive: r.isActive,
  }));

  const exceptionsRows = await executor
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.studioId, context.studioId),
        or(
          eq(calendarExceptions.masterId, masterId),
          isNull(calendarExceptions.masterId)
        ),
        isNull(calendarExceptions.deletedAt),
        lt(calendarExceptions.startAt, endBounds.nextDayStart),
        gt(calendarExceptions.endAt, startBounds.startOfDay)
      )
    );

  const exceptions: CalendarException[] = exceptionsRows.map((r) => ({
    id: r.id,
    studioId: r.studioId,
    masterId: r.masterId,
    type: r.type as CalendarException["type"],
    reason: r.reason,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
  }));

  const appointmentRows = await executor
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.studioId, context.studioId),
        eq(appointments.masterId, masterId),
        ne(appointments.status, "cancelled"),
        isNull(appointments.deletedAt),
        lt(appointments.startAt, endBounds.nextDayStart),
        gt(appointments.endAt, startBounds.startOfDay)
      )
    );

  const occupiedIntervals: OccupiedInterval[] = appointmentRows.map((r) => ({
    id: r.id,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
    appointmentId: r.id,
    source: "appointment",
  }));

  return resolveRangeAvailability({
    timezone,
    startDate,
    endDate,
    workingHours,
    exceptions,
    occupiedIntervals,
    slotDurationMinutes: durationMinutes,
    slotStepMinutes,
  });
}

/**
 * Calendar UI Read Model: Day / Week Schedule for all masters in a studio.
 */
export async function getStudioCalendarView(
  context: { studioId: string; userId: string },
  options: StudioCalendarViewOptions,
  executor: typeof db | Transaction = db
): Promise<StudioCalendarViewModel> {
  const { startDate, endDate, masterId, durationMinutes = 60 } = options;

  z.string().uuid().parse(context.studioId);
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    throw new Error("Invalid date range format. Expected 'YYYY-MM-DD'.");
  }

  const scope = await resourceScope(context, executor);

  const [studio] = await executor
    .select({ id: studios.id, timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, context.studioId));

  const timezone = normalizeTimezone(studio?.timezone);
  const dates = getDateRangeList(startDate, endDate);

  // Fetch target masters
  const targetMasters = await executor
    .select({
      id: masters.id,
      displayName: masters.displayName,
      photoUrl: masters.photoUrl,
      userId: masters.userId,
    })
    .from(masters)
    .where(
      and(
        eq(masters.studioId, context.studioId),
        isNull(masters.deletedAt),
        masterId ? eq(masters.id, masterId) : undefined,
        scope.isMaster ? scope.ownsMaster(masters.id) : undefined
      )
    );

  // Fetch studio-wide closures in range
  const startBounds = getDayBoundsInUtc(startDate, timezone);
  const endBounds = getDayBoundsInUtc(endDate, timezone);

  const studioClosuresRows = await executor
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.studioId, context.studioId),
        isNull(calendarExceptions.masterId),
        isNull(calendarExceptions.deletedAt),
        lt(calendarExceptions.startAt, endBounds.nextDayStart),
        gt(calendarExceptions.endAt, startBounds.startOfDay)
      )
    );

  const studioClosures: CalendarException[] = studioClosuresRows.map((r) => ({
    id: r.id,
    studioId: r.studioId,
    masterId: null,
    type: r.type as CalendarException["type"],
    reason: r.reason,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
  }));

  const masterViewModels: MasterCalendarViewModel[] = [];

  for (const m of targetMasters) {
    const days = await getMasterAvailabilityRange(
      context,
      {
        masterId: m.id,
        startDate,
        endDate,
        durationMinutes,
      },
      executor
    );

    masterViewModels.push({
      master: {
        id: m.id,
        displayName: m.displayName,
        photoUrl: m.photoUrl,
      },
      days,
    });
  }

  return {
    studioId: context.studioId,
    timezone,
    startDate,
    endDate,
    dates,
    studioClosures,
    masters: masterViewModels,
  };
}
