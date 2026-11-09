import "server-only";

import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  appointmentCycles,
  appointments,
  calendarExceptions,
  clients,
  masterAvailability,
  masters,
  services,
  studios,
  treatmentCycles,
} from "@/db/schema";
import { resourceScope } from "@/server/auth/scopes";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { writeAudit } from "@/server/services/audit-log.service";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { resolveEffectiveMedicalEligibility } from "@/features/medical/server/eligibility";
import { resolveEffectiveConsent } from "@/features/consent/server/coverage";
import { canonicalClientId } from "@/features/clients/server/identity";
import { randomUUID } from "node:crypto";
import {
  getDayBoundsInUtc,
  normalizeTimezone,
} from "@/features/calendar/domain/timezone";
import { resolveDayAvailability } from "@/features/calendar/domain/availability";
import { type CalendarException, type WorkingInterval } from "@/features/calendar/domain/types";
import {
  dispatchAutomationTrigger,
  cancelPendingAutomations,
} from "@/features/automations/server/engine";
import { enqueue } from "@/server/events/outbox";

export interface AppointmentContext {
  studioId: string;
  userId: string;
  role?: string;
  [key: string]: unknown;
}

export interface CreateAppointmentInput {
  clientId: string;
  masterId: string;
  cycleId: string;
  serviceId?: string;
  visitKind?: "consultation" | "procedure" | "touch_up";
  startsAt: Date | string;
  endsAt: Date | string;
  notes?: string | null;
  source?: "whatsapp" | "instagram" | "phone" | "walk_in" | "referral" | "returning_client" | "other";
}

export interface RescheduleAppointmentInput {
  appointmentId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  reason?: string;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  reason?: string;
}

/**
 * Validates and locks resources in a deterministic order to prevent deadlocks:
 * 1. Master concurrency lock (PostgreSQL transactional advisory lock + Master row lock)
 * 2. Client row lock (FOR UPDATE)
 * 3. TreatmentCycle row lock (FOR UPDATE)
 */
async function acquireBookingLocks(
  tx: Transaction,
  studioId: string,
  masterId: string,
  clientId: string,
  cycleId: string,
  dayBucket: string
) {
  // 1. Transactional advisory lock for Master on the specific date
  const lockKey = `${studioId}:${masterId}:${dayBucket}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  // 2. Lock Master row
  const [masterRow] = await tx
    .select({ id: masters.id, userId: masters.userId, displayName: masters.displayName, photoUrl: masters.photoUrl })
    .from(masters)
    .where(and(eq(masters.id, masterId), eq(masters.studioId, studioId), isNull(masters.deletedAt)))
    .for("update");

  if (!masterRow) {
    throw new Error("Master not found in this studio");
  }

  // 3. Lock Client row
  const [clientRow] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId), isNull(clients.deletedAt)))
    .for("update");

  if (!clientRow) {
    throw new Error("Client not found in this studio");
  }

  // 4. Lock TreatmentCycle row
  const [cycleRow] = await tx
    .select()
    .from(treatmentCycles)
    .where(and(eq(treatmentCycles.id, cycleId), eq(treatmentCycles.studioId, studioId), isNull(treatmentCycles.archivedAt)))
    .for("update");

  if (!cycleRow) {
    throw new Error("Treatment cycle not found in this studio");
  }

  if (cycleRow.clientId !== clientId) {
    throw new Error("Treatment cycle does not belong to the specified client");
  }

  return { masterRow, clientRow, cycleRow };
}

/**
 * Re-checks master calendar availability within the active transaction.
 */
async function verifySlotAvailability(
  tx: Transaction,
  studioId: string,
  masterId: string,
  startsAt: Date,
  endsAt: Date,
  excludeAppointmentId?: string
) {
  // 1. Fetch Studio timezone
  const [studio] = await tx
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, studioId));

  const timezone = normalizeTimezone(studio?.timezone);

  // 2. Check for conflicting active appointments
  const conflictingAppointments = await tx
    .select({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.studioId, studioId),
        eq(appointments.masterId, masterId),
        ne(appointments.status, "cancelled"),
        isNull(appointments.deletedAt),
        excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
        lt(appointments.startAt, endsAt),
        gt(appointments.endAt, startsAt)
      )
    );

  if (conflictingAppointments.length > 0) {
    throw new Error("Selected time conflicts with an existing appointment");
  }

  // 3. Check Working Hours and Exceptions via Day Availability
  // Calculate local date for startsAt in studio timezone
  const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = localDateFormatter.format(startsAt);
  const dayBounds = getDayBoundsInUtc(localDate, timezone);

  const workingHoursRows = await tx
    .select()
    .from(masterAvailability)
    .where(
      and(
        eq(masterAvailability.studioId, studioId),
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

  const exceptionsRows = await tx
    .select()
    .from(calendarExceptions)
    .where(
      and(
        eq(calendarExceptions.studioId, studioId),
        or(eq(calendarExceptions.masterId, masterId), isNull(calendarExceptions.masterId)),
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

  const durationMinutes = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));

  const dayAvailability = resolveDayAvailability({
    timezone,
    date: localDate,
    workingHours,
    exceptions,
    occupiedIntervals: [], // We already checked conflicting appointments directly
    slotDurationMinutes: durationMinutes,
  });

  // Check if [startsAt, endsAt) falls inside at least one available interval
  const isCovered = dayAvailability.availableIntervals.some(
    (int) => startsAt >= int.startAt && endsAt <= int.endAt
  );

  if (!isCovered) {
    throw new Error("Selected time is outside working hours or master is not available");
  }
}

/**
 * Transactional Booking Command: createAppointment
 */
export async function createAppointment(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  input: CreateAppointmentInput,
  idempotencyKey?: string
) {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  entityId.parse(input.clientId);
  entityId.parse(input.masterId);
  entityId.parse(input.cycleId);
  if (input.serviceId) entityId.parse(input.serviceId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    throw new Error("Invalid start or end date");
  }

  if (startsAt >= endsAt) {
    throw new Error("startsAt must be before endsAt");
  }

  const visitKind = input.visitKind ?? "consultation";
  const source = input.source ?? "other";

  const payload = {
    clientId: input.clientId,
    masterId: input.masterId,
    cycleId: input.cycleId,
    serviceId: input.serviceId ?? null,
    visitKind,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    notes: input.notes ?? null,
    source,
  };

  const executeCore = async (tx: Transaction, commandId: string) => {
    // 1. Authorize actor
    const scope = await resourceScope(context, tx);
    if (scope.isMaster) {
      const [owns] = await tx
        .select({ id: masters.id })
        .from(masters)
        .where(
          and(
            eq(masters.id, input.masterId),
            eq(masters.studioId, context.studioId),
            eq(masters.userId, context.userId),
            isNull(masters.deletedAt)
          )
        );
      if (!owns) {
        throw new Error("Master can only book appointments for themselves");
      }
    }

    // Resolve canonical client ID if merged
    const resolvedClientId = await canonicalClientId(input.clientId, context.studioId, tx);

    // 2. Fetch studio timezone for day bucket lock
    const [studio] = await tx
      .select({ timezone: studios.timezone })
      .from(studios)
      .where(eq(studios.id, context.studioId));

    const timezone = normalizeTimezone(studio?.timezone);
    const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dayBucket = localDateFormatter.format(startsAt);

    // 3. Acquire deterministic locks
    const { masterRow, clientRow } = await acquireBookingLocks(
      tx,
      context.studioId,
      input.masterId,
      resolvedClientId,
      input.cycleId,
      dayBucket
    );

    // 4. Resolve service
    let serviceRow: typeof services.$inferSelect | null = null;
    if (input.serviceId) {
      const [svc] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, input.serviceId),
            eq(services.studioId, context.studioId),
            isNull(services.deletedAt)
          )
        );
      if (!svc) {
        throw new Error("Service not found in this studio");
      }
      serviceRow = svc;
    } else {
      const [svc] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.studioId, context.studioId),
            isNull(services.deletedAt),
            eq(services.isActive, true)
          )
        )
        .limit(1);
      if (!svc) {
        throw new Error("No active service available in this studio");
      }
      serviceRow = svc;
    }

    // 5. Enforce Medical Eligibility & Consent Guards
    if (visitKind === "procedure" || visitKind === "touch_up") {
      const eligibility = await resolveEffectiveMedicalEligibility(
        { studioId: context.studioId, userId: context.userId },
        input.cycleId,
        tx
      );

      if (eligibility.status !== "CLEARED" && eligibility.status !== "NOT_APPLICABLE") {
        throw new Error(
          `Cannot schedule procedure appointment: client medical eligibility is ${eligibility.status} (${eligibility.reasonCode}). Medical clearance is required.`
        );
      }

      const consent = await resolveEffectiveConsent(
        { studioId: context.studioId, userId: context.userId },
        input.cycleId,
        tx
      );

      if (consent.status !== "COVERED") {
        throw new Error(
          `Cannot schedule procedure appointment: effective signed consent is required (current status: ${consent.status}).`
        );
      }
    }

    // 6. Re-check slot availability inside the transaction
    await verifySlotAvailability(
      tx,
      context.studioId,
      input.masterId,
      startsAt,
      endsAt
    );

    // 7. Snapshots
    const durationMinutes = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));
    const priceCents = serviceRow.priceCents ?? 0;

    const serviceSnapshot = {
      id: serviceRow.id,
      name: serviceRow.name,
      category: serviceRow.category,
      procedureType: serviceRow.procedureType,
      priceCents: serviceRow.priceCents,
      durationMinutes: serviceRow.durationMinutes,
    };

    const clientSnapshot = {
      id: clientRow.id,
      firstName: clientRow.firstName,
      lastName: clientRow.lastName,
      fullName: clientRow.fullName,
      phone: clientRow.phone,
    };

    const masterSnapshot = {
      id: masterRow.id,
      displayName: masterRow.displayName,
    };

    // 8. Insert Appointment
    const [appointment] = await tx
      .insert(appointments)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        masterId: input.masterId,
        serviceId: serviceRow.id,
        startAt: startsAt,
        endAt: endsAt,
        status: "confirmed",
        source,
        notes: input.notes ?? null,
        createdById: context.userId,
        serviceSnapshot,
        clientSnapshot,
        masterSnapshot,
        priceSnapshotCents: priceCents,
        durationSnapshotMinutes: durationMinutes,
      })
      .returning();

    // 9. Insert AppointmentCycle link
    const [appointmentCycle] = await tx
      .insert(appointmentCycles)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        appointmentId: appointment.id,
        cycleId: input.cycleId,
        visitKind,
        serviceSnapshot,
      })
      .returning();

    // 10. Audit log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "appointment_created",
      entityType: "appointment",
      entityId: appointment.id,
      before: null,
      after: appointment,
      reason: "command:appointment_created",
      reasonSource: "command",
      metadata: { commandId, cycleId: input.cycleId, visitKind },
    });

    // 11. Dispatch automations (appointment reminders)
    await dispatchAutomationTrigger(tx, context, {
      type: "APPOINTMENT_CREATED",
      studioId: context.studioId,
      entityType: "appointment",
      entityId: appointment.id,
      clientId: appointment.clientId,
      referenceTime: appointment.startAt,
      metadata: { status: appointment.status, serviceId: appointment.serviceId },
    });

    // 12. Enqueue Google Calendar sync
    await enqueue(
      tx,
      {
        studioId: context.studioId,
        eventKey: `google-calendar-sync:${appointment.id}:${commandId}`,
        handler: "google-calendar.sync-appointment.v1",
        effectType: "transactional",
      },
      { appointmentId: appointment.id, action: "upsert" }
    );

    return {
      appointment,
      appointmentCycle,
    };
  };

  const reqKey = idempotencyKey ?? randomUUID();

  const res = await idempotentCommand<Json>(
    context,
    "APPOINTMENT_CREATE",
    "appointment.create.v1",
    reqKey,
    JSON.parse(JSON.stringify(payload)) as Json,
    async (tx, commandId) => {
      const r = await executeCore(tx, commandId);
      return JSON.parse(JSON.stringify(r)) as Json;
    },
    async (tx, result) => {
      const resObj = result as { appointment?: { id?: string } } | null;
      if (!resObj?.appointment?.id) throw new Error("Appointment not found");
      const [row] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, resObj.appointment.id),
            eq(appointments.studioId, context.studioId)
          )
        );
      if (!row) throw new Error("Appointment not found");
    }
  );

  return res as unknown as {
    appointment: typeof appointments.$inferSelect;
    appointmentCycle: typeof appointmentCycles.$inferSelect;
  };
}

/**
 * Transactional Reschedule Command: rescheduleAppointment
 */
export async function rescheduleAppointment(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  input: RescheduleAppointmentInput,
  idempotencyKey?: string
) {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  entityId.parse(input.appointmentId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    throw new Error("Invalid start or end date");
  }

  if (startsAt >= endsAt) {
    throw new Error("startsAt must be before endsAt");
  }

  const payload = {
    appointmentId: input.appointmentId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    reason: input.reason ?? null,
  };

  const executeCore = async (tx: Transaction, commandId: string) => {
    const scope = await resourceScope(context, tx);

    // 1. Lock existing appointment
    const [existing] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, input.appointmentId),
          eq(appointments.studioId, context.studioId),
          isNull(appointments.deletedAt)
        )
      )
      .for("update");

    if (!existing) {
      throw new Error("Appointment not found in this studio");
    }

    if (existing.status === "cancelled") {
      throw new Error("Cannot reschedule a cancelled appointment");
    }

    if (scope.isMaster) {
      const [owns] = await tx
        .select({ id: masters.id })
        .from(masters)
        .where(
          and(
            eq(masters.id, existing.masterId),
            eq(masters.studioId, context.studioId),
            eq(masters.userId, context.userId),
            isNull(masters.deletedAt)
          )
        );
      if (!owns) {
        throw new Error("Master can only reschedule their own appointments");
      }
    }

    // 2. Fetch studio timezone for day bucket lock
    const [studio] = await tx
      .select({ timezone: studios.timezone })
      .from(studios)
      .where(eq(studios.id, context.studioId));

    const timezone = normalizeTimezone(studio?.timezone);
    const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dayBucket = localDateFormatter.format(startsAt);

    // 3. Acquire transactional advisory lock for master day
    const lockKey = `${context.studioId}:${existing.masterId}:${dayBucket}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    // 4. Verify slot availability (excluding current appointment)
    await verifySlotAvailability(
      tx,
      context.studioId,
      existing.masterId,
      startsAt,
      endsAt,
      existing.id
    );

    const oldStartAt = existing.startAt;
    const oldEndAt = existing.endAt;

    // 5. Update appointment
    const [updated] = await tx
      .update(appointments)
      .set({
        startAt: startsAt,
        endAt: endsAt,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, existing.id))
      .returning();

    // 6. Write audit log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "appointment_rescheduled",
      entityType: "appointment",
      entityId: existing.id,
      before: existing,
      after: updated,
      reason: input.reason ?? "command:appointment_rescheduled",
      reasonSource: input.reason ? "user" : "command",
      metadata: {
        commandId,
        oldStartAt: new Date(oldStartAt).toISOString(),
        oldEndAt: new Date(oldEndAt).toISOString(),
        newStartAt: startsAt.toISOString(),
        newEndAt: endsAt.toISOString(),
      },
    });

    // 7. Invalidate obsolete reminders and schedule new reminders
    await cancelPendingAutomations(tx, context.studioId, {
      entityType: "appointment",
      entityId: updated.id,
      reason: "appointment_rescheduled",
    });

    await dispatchAutomationTrigger(tx, context, {
      type: "APPOINTMENT_RESCHEDULED",
      studioId: context.studioId,
      entityType: "appointment",
      entityId: updated.id,
      clientId: updated.clientId,
      referenceTime: updated.startAt,
      metadata: { status: updated.status, serviceId: updated.serviceId },
    });

    // 8. Enqueue Google Calendar sync
    await enqueue(
      tx,
      {
        studioId: context.studioId,
        eventKey: `google-calendar-sync:${updated.id}:${commandId}`,
        handler: "google-calendar.sync-appointment.v1",
        effectType: "transactional",
      },
      { appointmentId: updated.id, action: "upsert" }
    );

    return { appointment: updated };
  };

  const reqKey = idempotencyKey ?? randomUUID();

  const res = await idempotentCommand<Json>(
    context,
    "APPOINTMENT_UPDATE",
    "appointment.reschedule.v1",
    reqKey,
    JSON.parse(JSON.stringify(payload)) as Json,
    async (tx, commandId) => {
      const r = await executeCore(tx, commandId);
      return JSON.parse(JSON.stringify(r)) as Json;
    },
    async (tx, result) => {
      const resObj = result as { appointment?: { id?: string } } | null;
      if (!resObj?.appointment?.id) throw new Error("Appointment not found");
      const [row] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, resObj.appointment.id),
            eq(appointments.studioId, context.studioId)
          )
        );
      if (!row) throw new Error("Appointment not found");
    }
  );

  return res as unknown as { appointment: typeof appointments.$inferSelect };
}

/**
 * Transactional Cancellation Command: cancelAppointment
 */
export async function cancelAppointment(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  input: CancelAppointmentInput,
  idempotencyKey?: string
) {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  entityId.parse(input.appointmentId);

  const payload = {
    appointmentId: input.appointmentId,
    reason: input.reason ?? null,
  };

  const executeCore = async (tx: Transaction, commandId: string) => {
    const scope = await resourceScope(context, tx);

    const [existing] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, input.appointmentId),
          eq(appointments.studioId, context.studioId),
          isNull(appointments.deletedAt)
        )
      )
      .for("update");

    if (!existing) {
      throw new Error("Appointment not found in this studio");
    }

    if (scope.isMaster) {
      const [owns] = await tx
        .select({ id: masters.id })
        .from(masters)
        .where(
          and(
            eq(masters.id, existing.masterId),
            eq(masters.studioId, context.studioId),
            eq(masters.userId, context.userId),
            isNull(masters.deletedAt)
          )
        );
      if (!owns) {
        throw new Error("Master can only cancel their own appointments");
      }
    }

    // Idempotent: if already cancelled, return existing
    if (existing.status === "cancelled") {
      return { appointment: existing };
    }

    const cancelledAt = new Date();

    const [updated] = await tx
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: cancelledAt,
        cancelledById: context.userId,
        cancelReason: input.reason ?? null,
        updatedAt: cancelledAt,
      })
      .where(eq(appointments.id, existing.id))
      .returning();

    // Audit log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "appointment_cancelled",
      entityType: "appointment",
      entityId: existing.id,
      before: existing,
      after: updated,
      reason: input.reason ?? "command:appointment_cancelled",
      reasonSource: input.reason ? "user" : "command",
      metadata: {
        commandId,
        cancelledAt: cancelledAt.toISOString(),
      },
    });

    // Invalidate pending reminders & trigger cancellation automation
    await cancelPendingAutomations(tx, context.studioId, {
      entityType: "appointment",
      entityId: updated.id,
      reason: "appointment_cancelled",
    });

    await dispatchAutomationTrigger(tx, context, {
      type: "APPOINTMENT_CANCELLED",
      studioId: context.studioId,
      entityType: "appointment",
      entityId: updated.id,
      clientId: updated.clientId,
      referenceTime: updated.startAt,
    });

    // Enqueue Google Calendar deletion
    await enqueue(
      tx,
      {
        studioId: context.studioId,
        eventKey: `google-calendar-delete:${updated.id}:${commandId}`,
        handler: "google-calendar.delete-appointment.v1",
        effectType: "transactional",
      },
      { appointmentId: updated.id, action: "delete" }
    );

    return { appointment: updated };
  };

  const reqKey = idempotencyKey ?? randomUUID();

  const res = await idempotentCommand<Json>(
    context,
    "APPOINTMENT_CANCEL",
    "appointment.cancel.v1",
    reqKey,
    JSON.parse(JSON.stringify(payload)) as Json,
    async (tx, commandId) => {
      const r = await executeCore(tx, commandId);
      return JSON.parse(JSON.stringify(r)) as Json;
    },
    async (tx, result) => {
      const resObj = result as { appointment?: { id?: string } } | null;
      if (!resObj?.appointment?.id) throw new Error("Appointment not found");
      const [row] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, resObj.appointment.id),
            eq(appointments.studioId, context.studioId)
          )
        );
      if (!row) throw new Error("Appointment not found");
    }
  );

  return res as unknown as { appointment: typeof appointments.$inferSelect };
}

/**
 * Tenant-safe read helper: getAppointmentById
 */
export async function getAppointmentById(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  appointmentId: string
) {
  entityId.parse(context.studioId);
  entityId.parse(appointmentId);

  const scope = await resourceScope(context, dbExecutor);

  const [row] = await dbExecutor
    .select({
      appointment: appointments,
      cycleLink: appointmentCycles,
      client: {
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        fullName: clients.fullName,
        phone: clients.phone,
      },
      master: {
        id: masters.id,
        displayName: masters.displayName,
        photoUrl: masters.photoUrl,
      },
      cycle: {
        id: treatmentCycles.id,
        zoneCode: treatmentCycles.zoneCode,
        stage: treatmentCycles.stage,
        kind: treatmentCycles.kind,
      },
    })
    .from(appointments)
    .leftJoin(appointmentCycles, eq(appointmentCycles.appointmentId, appointments.id))
    .leftJoin(clients, eq(clients.id, appointments.clientId))
    .leftJoin(masters, eq(masters.id, appointments.masterId))
    .leftJoin(treatmentCycles, eq(treatmentCycles.id, appointmentCycles.cycleId))
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.studioId, context.studioId),
        isNull(appointments.deletedAt),
        scope.isMaster ? scope.ownsMaster(sql`${appointments.masterId}`) : undefined
      )
    );

  if (!row) {
    throw new Error("Appointment not found or not accessible");
  }

  return row;
}

/**
 * Tenant-safe read helper: listAppointmentsForDay
 */
export async function listAppointmentsForDay(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  dateStr: string,
  masterId?: string
) {
  entityId.parse(context.studioId);

  const [studio] = await dbExecutor
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, context.studioId));

  const timezone = normalizeTimezone(studio?.timezone);
  const dayBounds = getDayBoundsInUtc(dateStr, timezone);

  return listAppointmentsForRange(
    dbExecutor,
    context,
    dayBounds.startOfDay,
    dayBounds.nextDayStart,
    masterId
  );
}

/**
 * Tenant-safe read helper: listAppointmentsForRange
 */
export async function listAppointmentsForRange(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  startsAt: Date,
  endsAt: Date,
  masterId?: string
) {
  entityId.parse(context.studioId);

  const scope = await resourceScope(context, dbExecutor);

  const rows = await dbExecutor
    .select({
      appointment: appointments,
      cycleLink: appointmentCycles,
      client: {
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        fullName: clients.fullName,
        phone: clients.phone,
      },
      master: {
        id: masters.id,
        displayName: masters.displayName,
      },
      cycle: {
        id: treatmentCycles.id,
        zoneCode: treatmentCycles.zoneCode,
        stage: treatmentCycles.stage,
      },
    })
    .from(appointments)
    .leftJoin(appointmentCycles, eq(appointmentCycles.appointmentId, appointments.id))
    .leftJoin(clients, eq(clients.id, appointments.clientId))
    .leftJoin(masters, eq(masters.id, appointments.masterId))
    .leftJoin(treatmentCycles, eq(treatmentCycles.id, appointmentCycles.cycleId))
    .where(
      and(
        eq(appointments.studioId, context.studioId),
        isNull(appointments.deletedAt),
        lt(appointments.startAt, endsAt),
        gt(appointments.endAt, startsAt),
        masterId ? eq(appointments.masterId, masterId) : undefined,
        scope.isMaster ? scope.ownsMaster(sql`${appointments.masterId}`) : undefined
      )
    )
    .orderBy(appointments.startAt);

  return rows;
}

/**
 * Tenant-safe read helper: listClientAppointments
 */
export async function listClientAppointments(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  clientId: string
) {
  entityId.parse(context.studioId);
  entityId.parse(clientId);

  const resolvedClientId = await canonicalClientId(clientId, context.studioId, dbExecutor);
  const scope = await resourceScope(context, dbExecutor);

  const rows = await dbExecutor
    .select({
      appointment: appointments,
      cycleLink: appointmentCycles,
      master: {
        id: masters.id,
        displayName: masters.displayName,
      },
    })
    .from(appointments)
    .leftJoin(appointmentCycles, eq(appointmentCycles.appointmentId, appointments.id))
    .leftJoin(masters, eq(masters.id, appointments.masterId))
    .where(
      and(
        eq(appointments.studioId, context.studioId),
        eq(appointments.clientId, resolvedClientId),
        isNull(appointments.deletedAt),
        scope.isMaster ? scope.ownsMaster(sql`${appointments.masterId}`) : undefined
      )
    )
    .orderBy(appointments.startAt);

  return rows;
}

/**
 * Tenant-safe read helper: listMasterAppointments
 */
export async function listMasterAppointments(
  dbExecutor: typeof db | Transaction,
  context: AppointmentContext,
  masterId: string,
  range?: { startsAt: Date; endsAt: Date }
) {
  entityId.parse(context.studioId);
  entityId.parse(masterId);

  const scope = await resourceScope(context, dbExecutor);

  if (scope.isMaster) {
    const [owns] = await dbExecutor
      .select({ id: masters.id })
      .from(masters)
      .where(
        and(
          eq(masters.id, masterId),
          eq(masters.studioId, context.studioId),
          eq(masters.userId, context.userId),
          isNull(masters.deletedAt)
        )
      );
    if (!owns) {
      throw new Error("Master can only access their own appointments");
    }
  }

  const rows = await dbExecutor
    .select({
      appointment: appointments,
      cycleLink: appointmentCycles,
      client: {
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        fullName: clients.fullName,
        phone: clients.phone,
      },
    })
    .from(appointments)
    .leftJoin(appointmentCycles, eq(appointmentCycles.appointmentId, appointments.id))
    .leftJoin(clients, eq(clients.id, appointments.clientId))
    .where(
      and(
        eq(appointments.studioId, context.studioId),
        eq(appointments.masterId, masterId),
        isNull(appointments.deletedAt),
        range ? lt(appointments.startAt, range.endsAt) : undefined,
        range ? gt(appointments.endAt, range.startsAt) : undefined
      )
    )
    .orderBy(appointments.startAt);

  return rows;
}
