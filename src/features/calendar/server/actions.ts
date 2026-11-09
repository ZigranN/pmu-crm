"use server";

import { db } from "@/db";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { revalidatePath } from "next/cache";
import {
  setMasterWorkingHours,
  createCalendarException,
  updateCalendarException,
  deleteCalendarException,
  type SetWorkingHoursInput,
  type CreateCalendarExceptionInput,
  type UpdateCalendarExceptionInput,
} from "./service";
import {
  getMasterAvailability,
  getMasterAvailabilityRange,
  getStudioCalendarView,
  type MasterAvailabilityOptions,
  type MasterRangeAvailabilityOptions,
  type StudioCalendarViewOptions,
} from "./availability";

/**
 * Sets master recurring working schedule.
 */
export async function setMasterWorkingHoursAction(input: SetWorkingHoursInput) {
  const context = await requireBrowserStudioContext();
  const result = await db.transaction(async (tx) => {
    return setMasterWorkingHours(tx, context, input);
  });
  revalidatePath("/calendar");
  revalidatePath(`/masters/${input.masterId}/schedule`);
  return result;
}

/**
 * Creates calendar exception (DAY_OFF, BLOCKED_TIME, STUDIO_CLOSURE).
 */
export async function createCalendarExceptionAction(input: CreateCalendarExceptionInput) {
  const context = await requireBrowserStudioContext();
  const result = await db.transaction(async (tx) => {
    return createCalendarException(tx, context, input);
  });
  revalidatePath("/calendar");
  if (input.masterId) {
    revalidatePath(`/masters/${input.masterId}/schedule`);
  }
  return result;
}

/**
 * Updates calendar exception.
 */
export async function updateCalendarExceptionAction(input: UpdateCalendarExceptionInput) {
  const context = await requireBrowserStudioContext();
  const result = await db.transaction(async (tx) => {
    return updateCalendarException(tx, context, input);
  });
  revalidatePath("/calendar");
  return result;
}

/**
 * Soft deletes calendar exception.
 */
export async function deleteCalendarExceptionAction(input: { id: string; reason?: string }) {
  const context = await requireBrowserStudioContext();
  const result = await db.transaction(async (tx) => {
    return deleteCalendarException(tx, context, input);
  });
  revalidatePath("/calendar");
  return result;
}

/**
 * Reads single-day master availability.
 */
export async function getMasterAvailabilityAction(options: MasterAvailabilityOptions) {
  const context = await requireBrowserStudioContext();
  return getMasterAvailability(context, options, db);
}

/**
 * Reads range master availability.
 */
export async function getMasterAvailabilityRangeAction(options: MasterRangeAvailabilityOptions) {
  const context = await requireBrowserStudioContext();
  return getMasterAvailabilityRange(context, options, db);
}

/**
 * Reads complete studio calendar view model (day/week).
 */
export async function getStudioCalendarViewAction(options: StudioCalendarViewOptions) {
  const context = await requireBrowserStudioContext();
  return getStudioCalendarView(context, options, db);
}
