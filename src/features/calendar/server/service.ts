import "server-only";
import {
  calendarExceptions,
  masterAvailability,
  masters,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { lockStudioAccess } from "@/server/auth/scopes";
import type { Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";
import {
  timeStringToMinutes,
} from "../domain/availability";
import {
  type CalendarExceptionType,
  type WorkingInterval,
} from "../domain/types";
import { z } from "zod";

export interface SetWorkingHoursInput {
  masterId: string;
  intervals: Array<{
    weekday: number;
    startTime: string; // "HH:mm"
    endTime: string;   // "HH:mm"
    isActive?: boolean;
  }>;
  reason?: string;
}

export interface CreateCalendarExceptionInput {
  masterId?: string | null;
  type: CalendarExceptionType;
  reason?: string | null;
  startAt: Date | string;
  endAt: Date | string;
}

export interface UpdateCalendarExceptionInput {
  id: string;
  type?: CalendarExceptionType;
  reason?: string | null;
  startAt?: Date | string;
  endAt?: Date | string;
}

const timeFormatRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates intervals for weekday bounds, time format, start < end, and non-overlapping active intervals.
 */
export function validateWorkingIntervals(
  intervals: SetWorkingHoursInput["intervals"]
): void {
  const intervalsByDay: Record<number, Array<{ start: number; end: number }>> = {};

  for (const interval of intervals) {
    if (
      typeof interval.weekday !== "number" ||
      interval.weekday < 0 ||
      interval.weekday > 6
    ) {
      throw new Error(`Invalid weekday: ${interval.weekday}. Must be between 0 (Sunday) and 6 (Saturday).`);
    }

    if (!timeFormatRegex.test(interval.startTime)) {
      throw new Error(`Invalid startTime format: "${interval.startTime}". Expected "HH:mm" (00:00 - 23:59).`);
    }
    if (!timeFormatRegex.test(interval.endTime)) {
      throw new Error(`Invalid endTime format: "${interval.endTime}". Expected "HH:mm" (00:00 - 23:59).`);
    }

    const startMin = timeStringToMinutes(interval.startTime);
    const endMin = timeStringToMinutes(interval.endTime);

    if (startMin >= endMin) {
      throw new Error(
        `Invalid interval on weekday ${interval.weekday}: startTime (${interval.startTime}) must be strictly before endTime (${interval.endTime}).`
      );
    }

    if (interval.isActive !== false) {
      if (!intervalsByDay[interval.weekday]) {
        intervalsByDay[interval.weekday] = [];
      }

      // Check overlap with existing active intervals on this day
      for (const existing of intervalsByDay[interval.weekday]) {
        if (startMin < existing.end && endMin > existing.start) {
          throw new Error(
            `Overlapping active intervals detected on weekday ${interval.weekday}: ${interval.startTime}-${interval.endTime} overlaps an existing interval.`
          );
        }
      }

      intervalsByDay[interval.weekday].push({ start: startMin, end: endMin });
    }
  }
}

/**
 * Sets persistent recurring working hours for a Master.
 * Atomic transaction with audit logging.
 */
export async function setMasterWorkingHours(
  tx: Transaction,
  context: { studioId: string; userId: string },
  input: SetWorkingHoursInput
): Promise<WorkingInterval[]> {
  const { masterId, intervals, reason = "Master working schedule updated" } = input;

  z.string().uuid().parse(context.studioId);
  z.string().uuid().parse(masterId);
  validateWorkingIntervals(intervals);

  await lockStudioAccess(tx, context);

  // 1. Check Master exists and belongs to studio
  const [master] = await tx
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

  // 2. Authorize actor
  const canUpdate =
    (await hasPermission(tx, context.userId, context.studioId, "MASTER_UPDATE")) ||
    (await hasPermission(tx, context.userId, context.studioId, "STUDIO_MANAGE"));

  const isSelf = master.userId === context.userId;
  if (!canUpdate && !isSelf) {
    throw new Error("Permission denied");
  }

  // 3. Read before snapshot for audit
  const oldRows = await tx
    .select()
    .from(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, context.studioId),
        eq(masterAvailability.masterId, masterId)
      )
    );

  // 4. Delete existing rows and insert new rows atomically
  await tx
    .delete(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, context.studioId),
        eq(masterAvailability.masterId, masterId)
      )
    );

  const insertedRows: WorkingInterval[] = [];

  if (intervals.length > 0) {
    const rowsToInsert = intervals.map((i) => ({
      studioId: context.studioId,
      masterId,
      weekday: i.weekday,
      startTime: i.startTime,
      endTime: i.endTime,
      isActive: i.isActive ?? true,
    }));

    const inserted = await tx
      .insert(masterAvailability)
      .values(rowsToInsert)
      .returning();

    for (const r of inserted) {
      insertedRows.push({
        id: r.id,
        weekday: r.weekday,
        startTime: r.startTime,
        endTime: r.endTime,
        isActive: r.isActive,
      });
    }
  }

  // 5. Write audit log
  await writeAudit(tx, {
    studioId: context.studioId,
    userId: context.userId,
    action: "master_updated",
    entityType: "master",
    entityId: masterId,
    before: { workingHours: oldRows },
    after: { workingHours: insertedRows },
    reason,
    reasonSource: "command",
  });

  return insertedRows;
}

/**
 * Creates a Calendar Exception (DAY_OFF, BLOCKED_TIME, STUDIO_CLOSURE).
 */
export async function createCalendarException(
  tx: Transaction,
  context: { studioId: string; userId: string },
  input: CreateCalendarExceptionInput
) {
  const { masterId, type, reason, startAt: rawStart, endAt: rawEnd } = input;

  z.string().uuid().parse(context.studioId);
  const startAt = new Date(rawStart);
  const endAt = new Date(rawEnd);

  if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
    throw new Error("Invalid startAt or endAt timestamp.");
  }
  if (startAt.getTime() >= endAt.getTime()) {
    throw new Error("startAt must be strictly before endAt.");
  }

  await lockStudioAccess(tx, context);

  // Validate type & master scoping
  if (type === "STUDIO_CLOSURE") {
    if (masterId) {
      throw new Error("Studio closure cannot be associated with a specific master.");
    }
    const canManageStudio = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "STUDIO_MANAGE"
    );
    if (!canManageStudio) {
      throw new Error("Permission denied: STUDIO_MANAGE required for studio closure.");
    }
  } else {
    // Master exception (DAY_OFF or BLOCKED_TIME)
    if (masterId) {
      z.string().uuid().parse(masterId);
      const [master] = await tx
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

      const canUpdate =
        (await hasPermission(tx, context.userId, context.studioId, "MASTER_UPDATE")) ||
        (await hasPermission(tx, context.userId, context.studioId, "STUDIO_MANAGE"));
      const isSelf = master.userId === context.userId;
      if (!canUpdate && !isSelf) {
        throw new Error("Permission denied");
      }
    }
  }

  const [inserted] = await tx
    .insert(calendarExceptions)
    .values({
      studioId: context.studioId,
      masterId: masterId ?? null,
      type,
      reason: reason ?? null,
      startAt,
      endAt,
      createdById: context.userId,
    })
    .returning();

  // Audit log
  if (masterId) {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "master_updated",
      entityType: "master",
      entityId: masterId,
      before: null,
      after: { exception: inserted },
      reason: reason || `Created calendar exception ${type}`,
      reasonSource: "command",
    });
  } else {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "studio_settings_updated",
      entityType: "studio",
      entityId: context.studioId,
      before: null,
      after: { studioClosure: inserted },
      reason: reason || "Created studio closure",
      reasonSource: "command",
    });
  }

  return inserted;
}

/**
 * Updates a Calendar Exception.
 */
export async function updateCalendarException(
  tx: Transaction,
  context: { studioId: string; userId: string },
  input: UpdateCalendarExceptionInput
) {
  const { id, type, reason, startAt: rawStart, endAt: rawEnd } = input;

  z.string().uuid().parse(context.studioId);
  z.string().uuid().parse(id);

  await lockStudioAccess(tx, context);

  const [existing] = await tx
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.id, id),
        eq(calendarExceptions.studioId, context.studioId),
        isNull(calendarExceptions.deletedAt)
      )
    );

  if (!existing) {
    throw new Error("Calendar exception not found");
  }

  const startAt = rawStart !== undefined ? new Date(rawStart) : existing.startAt;
  const endAt = rawEnd !== undefined ? new Date(rawEnd) : existing.endAt;

  if (startAt.getTime() >= endAt.getTime()) {
    throw new Error("startAt must be strictly before endAt.");
  }

  const [updated] = await tx
    .update(calendarExceptions)
    .set({
      type: type ?? existing.type,
      reason: reason !== undefined ? reason : existing.reason,
      startAt,
      endAt,
      updatedAt: new Date(),
    })
    .where(eq(calendarExceptions.id, id))
    .returning();

  if (existing.masterId) {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "master_updated",
      entityType: "master",
      entityId: existing.masterId,
      before: { exception: existing },
      after: { exception: updated },
      reason: reason || "Updated calendar exception",
      reasonSource: "command",
    });
  } else {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "studio_settings_updated",
      entityType: "studio",
      entityId: context.studioId,
      before: { studioClosure: existing },
      after: { studioClosure: updated },
      reason: reason || "Updated studio closure",
      reasonSource: "command",
    });
  }

  return updated;
}

/**
 * Soft deletes a Calendar Exception.
 */
export async function deleteCalendarException(
  tx: Transaction,
  context: { studioId: string; userId: string },
  input: { id: string; reason?: string }
) {
  const { id, reason = "Deleted calendar exception" } = input;

  z.string().uuid().parse(context.studioId);
  z.string().uuid().parse(id);

  await lockStudioAccess(tx, context);

  const [existing] = await tx
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.id, id),
        eq(calendarExceptions.studioId, context.studioId),
        isNull(calendarExceptions.deletedAt)
      )
    );

  if (!existing) {
    throw new Error("Calendar exception not found");
  }

  const [deleted] = await tx
    .update(calendarExceptions)
    .set({
      deletedAt: new Date(),
      deletedById: context.userId,
      updatedAt: new Date(),
    })
    .where(eq(calendarExceptions.id, id))
    .returning();

  if (existing.masterId) {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "master_updated",
      entityType: "master",
      entityId: existing.masterId,
      before: { exception: existing },
      after: { exception: deleted },
      reason,
      reasonSource: "command",
    });
  } else {
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "studio_settings_updated",
      entityType: "studio",
      entityId: context.studioId,
      before: { studioClosure: existing },
      after: { studioClosure: deleted },
      reason,
      reasonSource: "command",
    });
  }

  return deleted;
}
