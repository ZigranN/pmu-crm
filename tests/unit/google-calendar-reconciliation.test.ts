import { describe, expect, it } from "vitest";
import {
  computeAppointmentSyncHash,
  evaluateReconciliationDecision,
} from "@/features/google-calendar/domain/reconciliation-policy";
import type { GoogleCalendarEvent } from "@/features/google-calendar/domain/types";

describe("Google Calendar Reconciliation Policy", () => {
  const baseStart = new Date("2026-10-20T10:00:00Z");
  const baseEnd = new Date("2026-10-20T12:00:00Z");

  it("computes deterministic sync hash", () => {
    const hash1 = computeAppointmentSyncHash({
      id: "appt-1",
      startAt: baseStart,
      endAt: baseEnd,
      status: "confirmed",
      clientName: "Jane Doe",
      serviceName: "Powder Brows",
    });

    const hash2 = computeAppointmentSyncHash({
      id: "appt-1",
      startAt: baseStart,
      endAt: baseEnd,
      status: "confirmed",
      clientName: "Jane Doe",
      serviceName: "Powder Brows",
    });

    expect(hash1).toBe(hash2);

    const hashChanged = computeAppointmentSyncHash({
      id: "appt-1",
      startAt: new Date("2026-10-20T11:00:00Z"),
      endAt: baseEnd,
      status: "confirmed",
      clientName: "Jane Doe",
      serviceName: "Powder Brows",
    });

    expect(hash1).not.toBe(hashChanged);
  });

  it("returns noop when appointment and remote event are in sync", async () => {
    const remoteEvent: GoogleCalendarEvent = {
      id: "gevent-1",
      status: "confirmed",
      start: { dateTime: baseStart.toISOString() },
      end: { dateTime: baseEnd.toISOString() },
    };

    const decision = await evaluateReconciliationDecision({
      crmAppointment: {
        id: "appt-1",
        startAt: baseStart,
        endAt: baseEnd,
        status: "confirmed",
      },
      remoteEvent,
    });

    expect(decision.action).toBe("noop");
  });

  it("returns cancel when remote event is cancelled/deleted", async () => {
    const remoteEvent: GoogleCalendarEvent = {
      id: "gevent-1",
      status: "cancelled",
      start: { dateTime: baseStart.toISOString() },
      end: { dateTime: baseEnd.toISOString() },
    };

    const decision = await evaluateReconciliationDecision({
      crmAppointment: {
        id: "appt-1",
        startAt: baseStart,
        endAt: baseEnd,
        status: "confirmed",
      },
      remoteEvent,
    });

    expect(decision.action).toBe("cancel");
  });

  it("returns reschedule when remote event shifted and slot is available", async () => {
    const shiftedStart = new Date("2026-10-20T14:00:00Z");
    const shiftedEnd = new Date("2026-10-20T16:00:00Z");

    const remoteEvent: GoogleCalendarEvent = {
      id: "gevent-1",
      status: "confirmed",
      start: { dateTime: shiftedStart.toISOString() },
      end: { dateTime: shiftedEnd.toISOString() },
    };

    const decision = await evaluateReconciliationDecision({
      crmAppointment: {
        id: "appt-1",
        startAt: baseStart,
        endAt: baseEnd,
        status: "confirmed",
      },
      remoteEvent,
      isMasterAvailableForSlot: async () => true,
    });

    expect(decision.action).toBe("reschedule");
    expect(decision.proposedStartsAt?.toISOString()).toBe(shiftedStart.toISOString());
    expect(decision.proposedEndsAt?.toISOString()).toBe(shiftedEnd.toISOString());
  });

  it("returns conflict when remote event shifted but master is unavailable", async () => {
    const shiftedStart = new Date("2026-10-20T14:00:00Z");
    const shiftedEnd = new Date("2026-10-20T16:00:00Z");

    const remoteEvent: GoogleCalendarEvent = {
      id: "gevent-1",
      status: "confirmed",
      start: { dateTime: shiftedStart.toISOString() },
      end: { dateTime: shiftedEnd.toISOString() },
    };

    const decision = await evaluateReconciliationDecision({
      crmAppointment: {
        id: "appt-1",
        startAt: baseStart,
        endAt: baseEnd,
        status: "confirmed",
      },
      remoteEvent,
      isMasterAvailableForSlot: async () => false,
    });

    expect(decision.action).toBe("conflict");
  });

  it("ignores remote changes if CRM appointment is already cancelled", async () => {
    const shiftedStart = new Date("2026-10-20T14:00:00Z");
    const shiftedEnd = new Date("2026-10-20T16:00:00Z");

    const remoteEvent: GoogleCalendarEvent = {
      id: "gevent-1",
      status: "confirmed",
      start: { dateTime: shiftedStart.toISOString() },
      end: { dateTime: shiftedEnd.toISOString() },
    };

    const decision = await evaluateReconciliationDecision({
      crmAppointment: {
        id: "appt-1",
        startAt: baseStart,
        endAt: baseEnd,
        status: "cancelled",
      },
      remoteEvent,
      isMasterAvailableForSlot: async () => true,
    });

    expect(decision.action).toBe("noop");
  });
});
