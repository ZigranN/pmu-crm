import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { parseLocalTimeToUtc } from "../../src/features/calendar/domain/timezone";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let createAppointment: typeof import("../../src/features/appointments/server/service").createAppointment;
let rescheduleAppointment: typeof import("../../src/features/appointments/server/service").rescheduleAppointment;
let cancelAppointment: typeof import("../../src/features/appointments/server/service").cancelAppointment;

let studioId: string;
let ownerUserId: string;
let master1Id: string;
let client1Id: string;
let client2Id: string;
let cycle1Id: string;
let cycle2Id: string;
let serviceId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const apptService = await import("../../src/features/appointments/server/service");
  createAppointment = apptService.createAppointment;
  rescheduleAppointment = apptService.rescheduleAppointment;
  cancelAppointment = apptService.cancelAppointment;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Concurrency Studio",
        slug: `conc-${randomUUID()}`,
        timezone: "Europe/Rome",
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Owner User
  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Owner",
    email: `${ownerUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(s.studioMembers).values({
    studioId,
    userId: ownerUserId,
    roleId: ownerRoleId,
    isActive: true,
  });

  // 3. Master
  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: ownerUserId,
      displayName: "Master Mario",
      isActive: true,
    })
    .returning();
  master1Id = m1.id;

  // Master working hours Mon-Fri 08:00 - 20:00
  const calendarService = await import("../../src/features/calendar/server/service");
  await calendarService.setMasterWorkingHours(
    db as any,
    { studioId, userId: ownerUserId },
    {
      masterId: master1Id,
      intervals: [
        { weekday: 1, startTime: "08:00", endTime: "20:00", isActive: true },
        { weekday: 2, startTime: "08:00", endTime: "20:00", isActive: true },
        { weekday: 3, startTime: "08:00", endTime: "20:00", isActive: true },
        { weekday: 4, startTime: "08:00", endTime: "20:00", isActive: true },
        { weekday: 5, startTime: "08:00", endTime: "20:00", isActive: true },
        { weekday: 6, startTime: "08:00", endTime: "20:00", isActive: false },
        { weekday: 0, startTime: "08:00", endTime: "20:00", isActive: false },
      ],
    }
  );

  // 4. Clients
  const [c1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Client 1",
      fullName: "Client One",
      phone: "+39000000001",
      clientStatus: "new_lead",
    })
    .returning();
  client1Id = c1.id;

  const [c2] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Client 2",
      fullName: "Client Two",
      phone: "+39000000002",
      clientStatus: "new_lead",
    })
    .returning();
  client2Id = c2.id;

  // 5. Treatment Cycles
  const [cy1] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client1Id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycle1Id = cy1.id;

  const [cy2] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client2Id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycle2Id = cy2.id;

  // 6. Service
  const [svc] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Brows",
      category: "brows",
      procedureType: "brows",
      priceCents: 20000,
      durationMinutes: 60,
      isActive: true,
    })
    .returning();
  serviceId = svc.id;
});

describe("Phase 5 - Concurrency & Race Condition Protection", () => {
  it("1. concurrent overlapping bookings for same Master: exactly one commits", async () => {
    // Tx A attempts 10:00 - 11:00 CEST (2026-07-06 is Monday)
    // Tx B attempts 10:30 - 11:30 CEST
    const sA = parseLocalTimeToUtc("2026-07-06", "10:00", "Europe/Rome");
    const eA = parseLocalTimeToUtc("2026-07-06", "11:00", "Europe/Rome");
    const sB = parseLocalTimeToUtc("2026-07-06", "10:30", "Europe/Rome");
    const eB = parseLocalTimeToUtc("2026-07-06", "11:30", "Europe/Rome");

    const reqA = createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client1Id,
        masterId: master1Id,
        cycleId: cycle1Id,
        serviceId,
        visitKind: "consultation",
        startsAt: sA,
        endsAt: eA,
      }
    );

    const reqB = createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client2Id,
        masterId: master1Id,
        cycleId: cycle2Id,
        serviceId,
        visitKind: "consultation",
        startsAt: sB,
        endsAt: eB,
      }
    );

    const results = await Promise.allSettled([reqA, reqB]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify only 1 appointment row exists in DB for that slot range
    const appts = await db
      .select()
      .from(s.appointments)
      .where(
        and(
          eq(s.appointments.studioId, studioId),
          eq(s.appointments.masterId, master1Id),
          eq(s.appointments.status, "confirmed")
        )
      );
    expect(appts.length).toBe(1);
  });

  it("2. exact adjacent appointments both commit concurrently", async () => {
    // Tx A: 12:00 - 13:00 CEST
    // Tx B: 13:00 - 14:00 CEST
    const sA = parseLocalTimeToUtc("2026-07-06", "12:00", "Europe/Rome");
    const eA = parseLocalTimeToUtc("2026-07-06", "13:00", "Europe/Rome");
    const sB = parseLocalTimeToUtc("2026-07-06", "13:00", "Europe/Rome");
    const eB = parseLocalTimeToUtc("2026-07-06", "14:00", "Europe/Rome");

    const reqA = createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client1Id,
        masterId: master1Id,
        cycleId: cycle1Id,
        serviceId,
        visitKind: "consultation",
        startsAt: sA,
        endsAt: eA,
      }
    );

    const reqB = createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client2Id,
        masterId: master1Id,
        cycleId: cycle2Id,
        serviceId,
        visitKind: "consultation",
        startsAt: sB,
        endsAt: eB,
      }
    );

    const [resA, resB] = await Promise.all([reqA, reqB]);

    expect(resA.appointment.id).toBeDefined();
    expect(resB.appointment.id).toBeDefined();
    expect(resA.appointment.id).not.toBe(resB.appointment.id);
  });

  it("3. concurrent cancellation + competing booking: booking succeeds once freed", async () => {
    const s1 = parseLocalTimeToUtc("2026-07-07", "10:00", "Europe/Rome");
    const e1 = parseLocalTimeToUtc("2026-07-07", "11:00", "Europe/Rome");

    // Pre-create appointment
    const initial = await createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client1Id,
        masterId: master1Id,
        cycleId: cycle1Id,
        serviceId,
        visitKind: "consultation",
        startsAt: s1,
        endsAt: e1,
      }
    );

    // Cancel appointment
    await cancelAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        appointmentId: initial.appointment.id,
        reason: "Cancelled by client",
      }
    );

    // New booking for same slot succeeds
    const newBooking = await createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client2Id,
        masterId: master1Id,
        cycleId: cycle2Id,
        serviceId,
        visitKind: "consultation",
        startsAt: s1,
        endsAt: e1,
      }
    );

    expect(newBooking.appointment.id).toBeDefined();
    expect(newBooking.appointment.status).toBe("confirmed");
  });

  it("4. reschedule into competing occupied interval fails", async () => {
    // Appt 1: 14:00 - 15:00
    // Appt 2: 16:00 - 17:00
    const s1 = parseLocalTimeToUtc("2026-07-07", "14:00", "Europe/Rome");
    const e1 = parseLocalTimeToUtc("2026-07-07", "15:00", "Europe/Rome");
    const s2 = parseLocalTimeToUtc("2026-07-07", "16:00", "Europe/Rome");
    const e2 = parseLocalTimeToUtc("2026-07-07", "17:00", "Europe/Rome");

    await createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client1Id,
        masterId: master1Id,
        cycleId: cycle1Id,
        serviceId,
        visitKind: "consultation",
        startsAt: s1,
        endsAt: e1,
      }
    );

    const appt2 = await createAppointment(
      db,
      { studioId, userId: ownerUserId, role: "OWNER" },
      {
        clientId: client2Id,
        masterId: master1Id,
        cycleId: cycle2Id,
        serviceId,
        visitKind: "consultation",
        startsAt: s2,
        endsAt: e2,
      }
    );

    // Attempt to reschedule Appt 2 to 14:30 - 15:30 (overlaps Appt 1)
    const confStart = parseLocalTimeToUtc("2026-07-07", "14:30", "Europe/Rome");
    const confEnd = parseLocalTimeToUtc("2026-07-07", "15:30", "Europe/Rome");

    await expect(
      rescheduleAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          appointmentId: appt2.appointment.id,
          startsAt: confStart,
          endsAt: confEnd,
        }
      )
    ).rejects.toThrow("Selected time conflicts with an existing appointment");
  });

  it("5. parallel duplicate requests with identical idempotency key commit exactly once", async () => {
    const key = randomUUID();
    const s1 = parseLocalTimeToUtc("2026-07-08", "10:00", "Europe/Rome");
    const e1 = parseLocalTimeToUtc("2026-07-08", "11:00", "Europe/Rome");

    const payload = {
      clientId: client1Id,
      masterId: master1Id,
      cycleId: cycle1Id,
      serviceId,
      visitKind: "consultation" as const,
      startsAt: s1,
      endsAt: e1,
    };

    const requests = Array.from({ length: 4 }, () =>
      createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        payload,
        key
      )
    );

    const results = await Promise.all(requests);
    const appointmentIds = new Set(results.map((r) => r.appointment.id));

    expect(appointmentIds.size).toBe(1);

    const dbAppts = await db
      .select()
      .from(s.appointments)
      .where(
        and(
          eq(s.appointments.studioId, studioId),
          eq(s.appointments.id, results[0].appointment.id)
        )
      );
    expect(dbAppts.length).toBe(1);
  });
});
