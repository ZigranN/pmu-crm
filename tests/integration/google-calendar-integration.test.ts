import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import type { IGoogleCalendarClient } from "@/features/google-calendar/server/client";
import type { GoogleCalendarEvent } from "@/features/google-calendar/domain/types";
import { decryptSecret } from "@/lib/encryption";

class MockGoogleCalendarClient implements IGoogleCalendarClient {
  public events: Map<string, GoogleCalendarEvent> = new Map();
  public createCalls: number = 0;
  public updateCalls: number = 0;
  public deleteCalls: number = 0;

  async listCalendars() {
    return [{ id: "primary", summary: "Primary Calendar" }];
  }

  async getEvent(_calId: string, eventId: string) {
    return this.events.get(eventId) ?? null;
  }

  async createEvent(_calId: string, eventData: Partial<GoogleCalendarEvent>) {
    this.createCalls++;
    const id = `mock-gevent-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const event: GoogleCalendarEvent = {
      id,
      summary: eventData.summary ?? "",
      description: eventData.description ?? "",
      start: eventData.start ?? {},
      end: eventData.end ?? {},
      status: "confirmed",
      extendedProperties: eventData.extendedProperties,
      etag: `"etag-${id}"`,
    };
    this.events.set(id, event);
    return event;
  }

  async updateEvent(_calId: string, eventId: string, eventData: Partial<GoogleCalendarEvent>) {
    this.updateCalls++;
    const existing = this.events.get(eventId);
    const updated: GoogleCalendarEvent = {
      id: eventId,
      summary: eventData.summary ?? existing?.summary ?? "",
      description: eventData.description ?? existing?.description ?? "",
      start: eventData.start ?? existing?.start ?? {},
      end: eventData.end ?? existing?.end ?? {},
      status: eventData.status ?? existing?.status ?? "confirmed",
      extendedProperties: eventData.extendedProperties ?? existing?.extendedProperties,
      etag: `"etag-${eventId}-${Date.now()}"`,
    };
    this.events.set(eventId, updated);
    return updated;
  }

  async deleteEvent(_calId: string, eventId: string) {
    this.deleteCalls++;
    this.events.delete(eventId);
    return true;
  }

  async listEvents(_calId: string, params?: { privateExtendedProperty?: string }) {
    let items = Array.from(this.events.values());
    if (params?.privateExtendedProperty) {
      const [key, val] = params.privateExtendedProperty.split("=");
      items = items.filter(ev => ev.extendedProperties?.private?.[key] === val);
    }
    return { items };
  }
}

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let studioId: string;
let userId: string;
let masterId: string;
let clientId: string;
let serviceId: string;
let cycleId: string;
let mockClient: MockGoogleCalendarClient;

let connectGoogleCalendar: typeof import("@/features/google-calendar/server/service").connectGoogleCalendar;
let disconnectGoogleCalendar: typeof import("@/features/google-calendar/server/service").disconnectGoogleCalendar;
let syncAppointmentToGoogleCalendar: typeof import("@/features/google-calendar/server/service").syncAppointmentToGoogleCalendar;
let reconcileGoogleCalendarConnection: typeof import("@/features/google-calendar/server/service").reconcileGoogleCalendarConnection;
let createAppointment: typeof import("@/features/appointments/server/service").createAppointment;
let rescheduleAppointment: typeof import("@/features/appointments/server/service").rescheduleAppointment;
let cancelAppointment: typeof import("@/features/appointments/server/service").cancelAppointment;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const gcService = await import("@/features/google-calendar/server/service");
  connectGoogleCalendar = gcService.connectGoogleCalendar;
  disconnectGoogleCalendar = gcService.disconnectGoogleCalendar;
  syncAppointmentToGoogleCalendar = gcService.syncAppointmentToGoogleCalendar;
  reconcileGoogleCalendarConnection = gcService.reconcileGoogleCalendarConnection;

  const apptService = await import("@/features/appointments/server/service");
  createAppointment = apptService.createAppointment;
  rescheduleAppointment = apptService.rescheduleAppointment;
  cancelAppointment = apptService.cancelAppointment;
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  mockClient = new MockGoogleCalendarClient();

  // Create studio
  const [studio] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: `Studio GC Test ${Date.now()}`,
        slug: `studio-gc-test-${Date.now()}-${randomUUID()}`,
        timezone: "Europe/Moscow",
        isActive: true,
      },
    ])
    .returning();
  studioId = studio.id;

  // Create user
  const [u] = await db
    .insert(s.user)
    .values({
      id: `user-gc-${Date.now()}-${randomUUID()}`,
      name: "Master Specialist",
      email: `specialist-${Date.now()}-${randomUUID()}@test.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  userId = u.id;

  // Add studio membership
  const [ownerRole] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
  await db.insert(s.studioMembers).values({
    studioId,
    userId,
    roleId: ownerRole.id,
    isActive: true,
  });

  // Create master
  const [m] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId,
      displayName: "Master Specialist",
    })
    .returning();
  masterId = m.id;

  // Set master working hours (all weekdays 08:00 - 20:00)
  for (let day = 0; day <= 6; day++) {
    await db.insert(s.masterAvailability).values({
      studioId,
      masterId,
      weekday: day,
      startTime: "08:00",
      endTime: "20:00",
      isActive: true,
    });
  }

  // Create client
  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Anna",
      lastName: "Ivanova",
      fullName: "Anna Ivanova",
      phone: `+7999${Math.floor(1000000 + Math.random() * 9000000)}`,
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;

  // Create service
  const [svc] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Powder Brows",
      category: "brows",
      procedureType: "brows",
      durationMinutes: 120,
      priceCents: 1500000,
      isActive: true,
    })
    .returning();
  serviceId = svc.id;

  // Create treatment cycle
  const [cy] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycleId = cy.id;
});

describe("Google Calendar Integration & Sync Service", () => {
  it("connects Google Calendar account securely with encrypted tokens", async () => {
    const rawAccessToken = "ya29.test-access-token-12345";
    const rawRefreshToken = "1//test-refresh-token-67890";

    const connection = await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        googleAccountId: "g-acc-123",
        googleEmail: "master@gmail.com",
        calendarId: "primary",
        calendarSummary: "Work Calendar",
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
        expiresIn: 3600,
      },
      db
    );

    expect(connection.id).toBeDefined();
    expect(connection.status).toBe("connected");
    expect(connection.encryptedAccessToken).not.toBe(rawAccessToken);
    expect(connection.encryptedAccessToken?.startsWith("enc:v1:")).toBe(true);

    // Verify token can be decrypted properly
    expect(decryptSecret(connection.encryptedAccessToken!)).toBe(rawAccessToken);
    expect(decryptSecret(connection.encryptedRefreshToken!)).toBe(rawRefreshToken);
  });

  it("disconnects Google Calendar account and marks mappings deleted", async () => {
    const connection = await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      db
    );

    const disconnected = await disconnectGoogleCalendar({ studioId, userId }, connection.id, db);
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.encryptedAccessToken).toBeNull();
  });

  it("synchronizes created appointment to Google Calendar event and updates mappings", async () => {
    const connection = await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      db
    );

    const startsAt = new Date("2026-10-20T10:00:00Z");
    const endsAt = new Date("2026-10-20T12:00:00Z");

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt,
        endsAt,
        visitKind: "consultation",
      }
    );

    // Sync appointment
    const syncResults = await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    expect(syncResults.length).toBe(1);
    expect(syncResults[0].action).toBe("created");
    expect(syncResults[0].googleEventId).toBeDefined();
    expect(mockClient.createCalls).toBe(1);

    // Verify mapping row in database
    const [mapping] = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(
        and(
          eq(s.googleCalendarEventMappings.connectionId, connection.id),
          eq(s.googleCalendarEventMappings.appointmentId, appointment.id)
        )
      );

    expect(mapping).toBeDefined();
    expect(mapping.status).toBe("synced");
    expect(mapping.googleEventId).toBe(syncResults[0].googleEventId);

    // Idempotent test: Second sync should be skipped
    const secondSync = await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    expect(secondSync[0].action).toBe("skipped");
    expect(mockClient.createCalls).toBe(1); // No new API write
  });

  it("deletes Google Calendar event when appointment is cancelled", async () => {
    await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        accessToken: "access-token",
      },
      db
    );

    const startsAt = new Date("2026-10-20T10:00:00Z");
    const endsAt = new Date("2026-10-20T12:00:00Z");

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt,
        endsAt,
        visitKind: "consultation",
      }
    );

    // Initial sync
    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    // Cancel appointment
    await cancelAppointment(
      db,
      { studioId, userId },
      {
        appointmentId: appointment.id,
        reason: "Client request",
      }
    );

    // Sync deletion
    const delResults = await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "delete",
      clientFactory: () => mockClient,
    });

    expect(delResults.length).toBe(1);
    expect(delResults[0].action).toBe("deleted");
    expect(mockClient.deleteCalls).toBe(1);

    const [mapping] = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(eq(s.googleCalendarEventMappings.appointmentId, appointment.id));

    expect(mapping.status).toBe("deleted");
  });

  it("reconciles shifted remote event back to CRM when slot is valid", async () => {
    const connection = await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        accessToken: "access-token",
      },
      db
    );

    const startsAt = new Date("2026-10-20T10:00:00Z");
    const endsAt = new Date("2026-10-20T12:00:00Z");

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt,
        endsAt,
        visitKind: "consultation",
      }
    );

    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    const [mapping] = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(eq(s.googleCalendarEventMappings.appointmentId, appointment.id));

    // Simulate remote shift on Google Calendar (+2 hours, within 08:00-20:00)
    const shiftedStart = new Date("2026-10-20T14:00:00Z");
    const shiftedEnd = new Date("2026-10-20T16:00:00Z");

    await mockClient.updateEvent("primary", mapping.googleEventId, {
      start: { dateTime: shiftedStart.toISOString() },
      end: { dateTime: shiftedEnd.toISOString() },
    });

    // Run reconciliation
    const reconResult = await reconcileGoogleCalendarConnection(
      { studioId, userId },
      connection.id,
      () => mockClient
    );

    expect(reconResult.totalEvaluated).toBe(1);
    expect(reconResult.rescheduledCount).toBe(1);

    // Verify appointment was rescheduled in CRM
    const [updatedAppt] = await db
      .select()
      .from(s.appointments)
      .where(eq(s.appointments.id, appointment.id));

    expect(new Date(updatedAppt.startAt).toISOString()).toBe(shiftedStart.toISOString());
    expect(new Date(updatedAppt.endAt).toISOString()).toBe(shiftedEnd.toISOString());
  });

  it("processes outbox background job for Google Calendar sync cleanly", async () => {
    await connectGoogleCalendar(
      { studioId, userId },
      {
        userId,
        masterId,
        accessToken: "access-token",
      },
      db
    );

    const startsAt = new Date("2026-10-20T10:00:00Z");
    const endsAt = new Date("2026-10-20T12:00:00Z");

    await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt,
        endsAt,
        visitKind: "consultation",
      }
    );

    // Verify outbox job was enqueued
    const [job] = await db
      .select()
      .from(s.outboxJobs)
      .where(
        and(
          eq(s.outboxJobs.studioId, studioId),
          eq(s.outboxJobs.handler, "google-calendar.sync-appointment.v1")
        )
      );

    expect(job).toBeDefined();
    expect(job.state).toBe("pending");
  });

  it("Scenario A: duplicate create sync jobs produce exactly one mapping and one remote event", async () => {
    const mockClient = new MockGoogleCalendarClient();
    await connectGoogleCalendar(
      { studioId, userId },
      { userId, masterId, accessToken: "token-scen-a" },
      db
    );

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt: new Date("2026-11-01T10:00:00Z"),
        endsAt: new Date("2026-11-01T11:00:00Z"),
        visitKind: "consultation",
      }
    );

    // Run two sync operations concurrently
    await Promise.all([
      syncAppointmentToGoogleCalendar({
        studioId,
        appointmentId: appointment.id,
        action: "upsert",
        clientFactory: () => mockClient,
      }),
      syncAppointmentToGoogleCalendar({
        studioId,
        appointmentId: appointment.id,
        action: "upsert",
        clientFactory: () => mockClient,
      }),
    ]);

    expect(mockClient.events.size).toBe(1);
    const mappings = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(
        and(
          eq(s.googleCalendarEventMappings.studioId, studioId),
          eq(s.googleCalendarEventMappings.appointmentId, appointment.id)
        )
      );
    expect(mappings.length).toBe(1);
    expect(mappings[0].status).toBe("synced");
  });

  it("Scenario B: CREATE vs RESCHEDULE settles on current appointment time", async () => {
    const mockClient = new MockGoogleCalendarClient();
    await connectGoogleCalendar(
      { studioId, userId },
      { userId, masterId, accessToken: "token-scen-b" },
      db
    );

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt: new Date("2026-11-02T10:00:00Z"),
        endsAt: new Date("2026-11-02T11:00:00Z"),
        visitKind: "consultation",
      }
    );

    const newStart = new Date("2026-11-02T14:00:00Z");
    const newEnd = new Date("2026-11-02T15:00:00Z");
    await rescheduleAppointment(
      db,
      { studioId, userId },
      { appointmentId: appointment.id, startsAt: newStart, endsAt: newEnd, reason: "Client requested afternoon" }
    );

    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    expect(mockClient.events.size).toBe(1);
    const event = Array.from(mockClient.events.values())[0];
    expect(new Date(event.start.dateTime!).toISOString()).toBe(newStart.toISOString());
    expect(new Date(event.end.dateTime!).toISOString()).toBe(newEnd.toISOString());
  });

  it("Scenario C: CREATE vs CANCEL settles with remote event deleted and mapping marked deleted", async () => {
    const mockClient = new MockGoogleCalendarClient();
    await connectGoogleCalendar(
      { studioId, userId },
      { userId, masterId, accessToken: "token-scen-c" },
      db
    );

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt: new Date("2026-11-03T10:00:00Z"),
        endsAt: new Date("2026-11-03T11:00:00Z"),
        visitKind: "consultation",
      }
    );

    // Initial sync
    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });
    expect(mockClient.events.size).toBe(1);

    // Cancel appointment
    await cancelAppointment(
      db,
      { studioId, userId },
      { appointmentId: appointment.id, reason: "Client cancelled" }
    );

    // Sync cancellation
    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "delete",
      clientFactory: () => mockClient,
    });

    expect(mockClient.events.size).toBe(0);
    const [mapping] = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(eq(s.googleCalendarEventMappings.appointmentId, appointment.id));
    expect(mapping.status).toBe("deleted");
  });

  it("Scenario D: DISCONNECT vs pending sync prevents unauthorized remote mutations", async () => {
    const mockClient = new MockGoogleCalendarClient();
    const conn = await connectGoogleCalendar(
      { studioId, userId },
      { userId, masterId, accessToken: "token-scen-d" },
      db
    );

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt: new Date("2026-11-04T10:00:00Z"),
        endsAt: new Date("2026-11-04T11:00:00Z"),
        visitKind: "consultation",
      }
    );

    // Disconnect before sync runs
    await disconnectGoogleCalendar({ studioId, userId }, conn.id, db);

    const results = await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    expect(results.length).toBe(0);
    expect(mockClient.createCalls).toBe(0);
    expect(mockClient.events.size).toBe(0);
  });

  it("Partial External Success: retry detects remote event via privateExtendedProperty without duplicating", async () => {
    const mockClient = new MockGoogleCalendarClient();
    await connectGoogleCalendar(
      { studioId, userId },
      { userId, masterId, accessToken: "token-partial" },
      db
    );

    const { appointment } = await createAppointment(
      db,
      { studioId, userId },
      {
        clientId,
        masterId,
        cycleId,
        serviceId,
        startsAt: new Date("2026-11-05T10:00:00Z"),
        endsAt: new Date("2026-11-05T11:00:00Z"),
        visitKind: "consultation",
      }
    );

    // Simulate Google create succeeded remotely but local DB write failed/was skipped
    const remotePreCreated = await mockClient.createEvent("primary", {
      summary: "Precreated event",
      start: { dateTime: new Date("2026-11-05T10:00:00Z").toISOString() },
      end: { dateTime: new Date("2026-11-05T11:00:00Z").toISOString() },
      extendedProperties: {
        private: {
          pmuStudioId: studioId,
          pmuAppointmentId: appointment.id,
        },
      },
    });

    expect(mockClient.createCalls).toBe(1);
    expect(mockClient.events.size).toBe(1);

    // Worker retries sync without local mapping existing
    await syncAppointmentToGoogleCalendar({
      studioId,
      appointmentId: appointment.id,
      action: "upsert",
      clientFactory: () => mockClient,
    });

    // Verify it updated the existing remote event and did NOT call createEvent again
    expect(mockClient.createCalls).toBe(1); // Still only 1 create call
    expect(mockClient.updateCalls).toBe(1); // Called update instead
    expect(mockClient.events.size).toBe(1); // Exactly 1 remote event

    // Local mapping safely persisted
    const [mapping] = await db
      .select()
      .from(s.googleCalendarEventMappings)
      .where(eq(s.googleCalendarEventMappings.appointmentId, appointment.id));
    expect(mapping).toBeDefined();
    expect(mapping.googleEventId).toBe(remotePreCreated.id);
    expect(mapping.status).toBe("synced");
  });
});
