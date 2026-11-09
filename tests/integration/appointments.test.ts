import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  parseLocalTimeToUtc,
} from "../../src/features/calendar/domain/timezone";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let createAppointment: typeof import("../../src/features/appointments/server/service").createAppointment;
let rescheduleAppointment: typeof import("../../src/features/appointments/server/service").rescheduleAppointment;
let cancelAppointment: typeof import("../../src/features/appointments/server/service").cancelAppointment;
let getAppointmentById: typeof import("../../src/features/appointments/server/service").getAppointmentById;
let listAppointmentsForDay: typeof import("../../src/features/appointments/server/service").listAppointmentsForDay;
let listAppointmentsForRange: typeof import("../../src/features/appointments/server/service").listAppointmentsForRange;
let listClientAppointments: typeof import("../../src/features/appointments/server/service").listClientAppointments;
let listMasterAppointments: typeof import("../../src/features/appointments/server/service").listMasterAppointments;

let studioId: string;
let studioId2: string;
let ownerUserId: string;
let master1UserId: string;
let master2UserId: string;
let strangerUserId: string;

let master1Id: string;
let master2Id: string;
let masterStudio2Id: string;
let clientId: string;
let clientStudio2Id: string;
let serviceId: string;
let cycleId: string;
let cycleStudio2Id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const apptService = await import("../../src/features/appointments/server/service");
  createAppointment = apptService.createAppointment;
  rescheduleAppointment = apptService.rescheduleAppointment;
  cancelAppointment = apptService.cancelAppointment;
  getAppointmentById = apptService.getAppointmentById;
  listAppointmentsForDay = apptService.listAppointmentsForDay;
  listAppointmentsForRange = apptService.listAppointmentsForRange;
  listClientAppointments = apptService.listClientAppointments;
  listMasterAppointments = apptService.listMasterAppointments;

  // 1. Create Studios
  const [st1] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Studio Rome",
        slug: `rome-${randomUUID()}`,
        timezone: "Europe/Rome",
      },
    ])
    .returning();
  studioId = st1.id;

  const [st2] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Studio NY",
        slug: `ny-${randomUUID()}`,
        timezone: "America/New_York",
      },
    ])
    .returning();
  studioId2 = st2.id;

  // 2. Create Users & Roles
  const roleRows = await db.select().from(s.roles);
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.code, r.id]));

  const createTestUser = async (name: string, roleCode: string, targetStudioId: string) => {
    const uId = `user-${randomUUID()}`;
    await db.insert(s.user).values({
      id: uId,
      name,
      email: `${uId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const roleId = roleIds[roleCode] ?? roleIds["OWNER"];
    await db.insert(s.studioMembers).values({
      studioId: targetStudioId,
      userId: uId,
      roleId,
      isActive: true,
    });

    return uId;
  };

  ownerUserId = await createTestUser("Owner User", "OWNER", studioId);
  await createTestUser("Admin User", "ADMIN", studioId);
  master1UserId = await createTestUser("Master 1 User", "MASTER", studioId);
  master2UserId = await createTestUser("Master 2 User", "MASTER", studioId);
  strangerUserId = await createTestUser("Stranger User", "OWNER", studioId2);

  // 3. Create Masters
  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: master1UserId,
      displayName: "Master Mario",
      isActive: true,
    })
    .returning();
  master1Id = m1.id;

  const [m2] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: master2UserId,
      displayName: "Master Luigi",
      isActive: true,
    })
    .returning();
  master2Id = m2.id;

  const [m3] = await db
    .insert(s.masters)
    .values({
      studioId: studioId2,
      userId: strangerUserId,
      displayName: "Master NY",
      isActive: true,
    })
    .returning();
  masterStudio2Id = m3.id;

  // Set default working hours for Master 1 and Master 2: Mon-Fri 09:00 - 18:00
  const calendarService = await import("../../src/features/calendar/server/service");
  await calendarService.setMasterWorkingHours(
    db as any,
    { studioId, userId: ownerUserId },
    {
      masterId: master1Id,
      intervals: [
        { weekday: 1, startTime: "09:00", endTime: "18:00", isActive: true }, // Mon
        { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true }, // Tue
        { weekday: 3, startTime: "09:00", endTime: "18:00", isActive: true }, // Wed
        { weekday: 4, startTime: "09:00", endTime: "18:00", isActive: true }, // Thu
        { weekday: 5, startTime: "09:00", endTime: "18:00", isActive: true }, // Fri
        { weekday: 6, startTime: "09:00", endTime: "18:00", isActive: false },
        { weekday: 0, startTime: "09:00", endTime: "18:00", isActive: false },
      ],
    }
  );

  await calendarService.setMasterWorkingHours(
    db as any,
    { studioId, userId: ownerUserId },
    {
      masterId: master2Id,
      intervals: [
        { weekday: 1, startTime: "09:00", endTime: "18:00", isActive: true }, // Mon
        { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true }, // Tue
        { weekday: 3, startTime: "09:00", endTime: "18:00", isActive: true }, // Wed
        { weekday: 4, startTime: "09:00", endTime: "18:00", isActive: true }, // Thu
        { weekday: 5, startTime: "09:00", endTime: "18:00", isActive: true }, // Fri
        { weekday: 6, startTime: "09:00", endTime: "18:00", isActive: false },
        { weekday: 0, startTime: "09:00", endTime: "18:00", isActive: false },
      ],
    }
  );

  // 4. Create Services
  const [svc] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Microblading Brows",
      category: "brows",
      procedureType: "brows",
      priceCents: 25000,
      durationMinutes: 120,
      isActive: true,
    })
    .returning();
  serviceId = svc.id;

  // 5. Create Clients
  const [cl] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Anna",
      fullName: "Anna Rossi",
      phone: "+3906123456",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = cl.id;

  const [cl2] = await db
    .insert(s.clients)
    .values({
      studioId: studioId2,
      firstName: "John",
      fullName: "John Doe",
      phone: "+12125550199",
      clientStatus: "new_lead",
    })
    .returning();
  clientStudio2Id = cl2.id;

  // 6. Create Treatment Cycles
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

  const [cy2] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId: studioId2,
      clientId: clientStudio2Id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycleStudio2Id = cy2.id;
});

describe("Phase 5 - Production Appointments & Booking Safety", () => {
  describe("1. Persistence & Validation", () => {
    it("rejects startsAt >= endsAt", async () => {
      const startsAt = new Date("2026-06-15T10:00:00Z");
      const endsAt = new Date("2026-06-15T09:00:00Z");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("startsAt must be before endsAt");
    });

    it("rejects invalid/cross-Studio Client", async () => {
      const startsAt = new Date("2026-06-15T10:00:00Z");
      const endsAt = new Date("2026-06-15T11:00:00Z");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId: clientStudio2Id,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("Client not found in this studio");
    });

    it("rejects invalid/cross-Studio Master", async () => {
      const startsAt = new Date("2026-06-15T10:00:00Z");
      const endsAt = new Date("2026-06-15T11:00:00Z");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: masterStudio2Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("Master not found in this studio");
    });

    it("rejects invalid/cross-Studio Cycle", async () => {
      const startsAt = new Date("2026-06-15T10:00:00Z");
      const endsAt = new Date("2026-06-15T11:00:00Z");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId: cycleStudio2Id,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("Treatment cycle not found in this studio");
    });
  });

  describe("2. Booking & Availability inside Transaction", () => {
    it("books a free consultation slot successfully within working hours", async () => {
      // 2026-06-15 is Monday (day 1). Rome is UTC+2 (CEST) in June.
      // Local 10:00 - 11:00 CEST => UTC 08:00 - 09:00
      const startsAt = parseLocalTimeToUtc("2026-06-15", "10:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-15", "11:00", "Europe/Rome");

      const result = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt,
          endsAt,
          notes: "First booking test",
        }
      );

      expect(result.appointment.id).toBeDefined();
      expect(result.appointment.status).toBe("confirmed");
      expect(result.appointment.studioId).toBe(studioId);
      expect(result.appointment.clientId).toBe(clientId);
      expect(result.appointment.masterId).toBe(master1Id);
      expect(result.appointmentCycle.visitKind).toBe("consultation");
      expect(result.appointmentCycle.cycleId).toBe(cycleId);
    });

    it("rejects booking outside working hours (e.g. 06:00 local time)", async () => {
      // Local 06:00 - 07:00 CEST (working hours are 09:00 - 18:00)
      const startsAt = parseLocalTimeToUtc("2026-06-15", "06:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-15", "07:00", "Europe/Rome");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("Selected time is outside working hours or master is not available");
    });

    it("rejects booking when master has a calendar exception / blocked time", async () => {
      const calendarService = await import("../../src/features/calendar/server/service");
      const excStart = parseLocalTimeToUtc("2026-06-16", "14:00", "Europe/Rome");
      const excEnd = parseLocalTimeToUtc("2026-06-16", "16:00", "Europe/Rome");

      await calendarService.createCalendarException(
        db as any,
        { studioId, userId: ownerUserId },
        {
          masterId: master1Id,
          type: "BLOCKED_TIME",
          reason: "Dentist Appointment",
          startAt: excStart,
          endAt: excEnd,
        }
      );

      // Attempt to book 14:30 - 15:30 on 2026-06-16
      const apptStart = parseLocalTimeToUtc("2026-06-16", "14:30", "Europe/Rome");
      const apptEnd = parseLocalTimeToUtc("2026-06-16", "15:30", "Europe/Rome");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt: apptStart,
            endsAt: apptEnd,
          }
        )
      ).rejects.toThrow("Selected time is outside working hours or master is not available");
    });

    it("rejects booking that overlaps an existing scheduled appointment", async () => {
      // 2026-06-15 10:00 - 11:00 is already booked from previous test
      // Try 10:30 - 11:30
      const startsAt = parseLocalTimeToUtc("2026-06-15", "10:30", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-15", "11:30", "Europe/Rome");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
          }
        )
      ).rejects.toThrow("Selected time conflicts with an existing appointment");
    });

    it("allows adjacent boundary appointment [11:00, 12:00) after [10:00, 11:00)", async () => {
      const startsAt = parseLocalTimeToUtc("2026-06-15", "11:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-15", "12:00", "Europe/Rome");

      const res = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt,
          endsAt,
        }
      );

      expect(res.appointment.id).toBeDefined();
      expect(res.appointment.status).toBe("confirmed");
    });
  });

  describe("3. Idempotency", () => {
    it("returns identical result for same idempotency key and payload", async () => {
      const reqKey = randomUUID();
      const startsAt = parseLocalTimeToUtc("2026-06-17", "10:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-17", "11:00", "Europe/Rome");

      const payload = {
        clientId,
        masterId: master1Id,
        cycleId,
        serviceId,
        visitKind: "consultation" as const,
        startsAt,
        endsAt,
      };

      const res1 = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        payload,
        reqKey
      );

      const res2 = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        payload,
        reqKey
      );

      expect(res1.appointment.id).toBe(res2.appointment.id);
    });

    it("rejects different payload with same idempotency key", async () => {
      const reqKey = randomUUID();
      const startsAt = parseLocalTimeToUtc("2026-06-17", "11:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-17", "12:00", "Europe/Rome");

      await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt,
          endsAt,
        },
        reqKey
      );

      // Same key, different notes / payload
      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "consultation",
            startsAt,
            endsAt,
            notes: "Altered payload",
          },
          reqKey
        )
      ).rejects.toThrow(/Ключ запроса|PAYLOAD_MISMATCH/i);
    });
  });

  describe("4. Rescheduling and Cancellation Lifecycle", () => {
    it("reschedules an appointment into a free slot", async () => {
      const startsAt = parseLocalTimeToUtc("2026-06-18", "10:00", "Europe/Rome");
      const endsAt = parseLocalTimeToUtc("2026-06-18", "11:00", "Europe/Rome");

      const appt = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt,
          endsAt,
        }
      );

      const newStartsAt = parseLocalTimeToUtc("2026-06-18", "14:00", "Europe/Rome");
      const newEndsAt = parseLocalTimeToUtc("2026-06-18", "15:00", "Europe/Rome");

      const res = await rescheduleAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          appointmentId: appt.appointment.id,
          startsAt: newStartsAt,
          endsAt: newEndsAt,
          reason: "Client requested afternoon slot",
        }
      );

      expect(res.appointment.id).toBe(appt.appointment.id);
      expect(new Date(res.appointment.startAt).getTime()).toBe(newStartsAt.getTime());
      expect(new Date(res.appointment.endAt).getTime()).toBe(newEndsAt.getTime());
    });

    it("rejects reschedule into a conflicting slot", async () => {
      // Book slot 1: 10:00 - 11:00 on 2026-06-19
      const s1 = parseLocalTimeToUtc("2026-06-19", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-19", "11:00", "Europe/Rome");
      await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );

      // Book slot 2: 12:00 - 13:00 on 2026-06-19
      const s2 = parseLocalTimeToUtc("2026-06-19", "12:00", "Europe/Rome");
      const e2 = parseLocalTimeToUtc("2026-06-19", "13:00", "Europe/Rome");
      const appt2 = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s2,
          endsAt: e2,
        }
      );

      // Attempt to reschedule appt2 to 10:30 - 11:30 (overlaps appt1)
      const conflictStart = parseLocalTimeToUtc("2026-06-19", "10:30", "Europe/Rome");
      const conflictEnd = parseLocalTimeToUtc("2026-06-19", "11:30", "Europe/Rome");

      await expect(
        rescheduleAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            appointmentId: appt2.appointment.id,
            startsAt: conflictStart,
            endsAt: conflictEnd,
          }
        )
      ).rejects.toThrow("Selected time conflicts with an existing appointment");
    });

    it("cancels an appointment and frees the slot for re-booking", async () => {
      const s1 = parseLocalTimeToUtc("2026-06-22", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-22", "11:00", "Europe/Rome");

      const appt = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );

      const cancelRes = await cancelAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          appointmentId: appt.appointment.id,
          reason: "Client caught flu",
        }
      );

      expect(cancelRes.appointment.status).toBe("cancelled");
      expect(cancelRes.appointment.cancelReason).toBe("Client caught flu");
      expect(cancelRes.appointment.cancelledById).toBe(ownerUserId);
      expect(cancelRes.appointment.cancelledAt).toBeDefined();

      // Repeated cancellation is idempotent
      const cancelRes2 = await cancelAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          appointmentId: appt.appointment.id,
          reason: "Second cancellation call",
        }
      );
      expect(cancelRes2.appointment.status).toBe("cancelled");

      // Slot is now free to be booked by someone else
      const rebook = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
          notes: "Rebooked after previous was cancelled",
        }
      );
      expect(rebook.appointment.id).toBeDefined();
      expect(rebook.appointment.status).toBe("confirmed");
    });
  });

  describe("5. Security & Tenant / Master Scope", () => {
    it("prevents master from reading other master's appointment", async () => {
      // Create appointment for Master 2
      const s1 = parseLocalTimeToUtc("2026-06-23", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-23", "11:00", "Europe/Rome");

      const appt = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master2Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );

      // Master 1 tries to read Master 2's appointment
      await expect(
        getAppointmentById(
          db,
          { studioId, userId: master1UserId, role: "MASTER" },
          appt.appointment.id
        )
      ).rejects.toThrow("Appointment not found or not accessible");
    });

    it("prevents cross-studio appointment access", async () => {
      const s1 = parseLocalTimeToUtc("2026-06-23", "14:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-23", "15:00", "Europe/Rome");

      const appt = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );

      // User from Studio 2 attempts to read
      await expect(
        getAppointmentById(
          db,
          { studioId: studioId2, userId: strangerUserId, role: "OWNER" },
          appt.appointment.id
        )
      ).rejects.toThrow("Appointment not found or not accessible");
    });

    it("lists appointments for day, range, client, and master with studio scoping", async () => {
      const dayList = await listAppointmentsForDay(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        "2026-06-23"
      );
      expect(dayList.length).toBeGreaterThan(0);

      const rangeList = await listAppointmentsForRange(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-06-30T23:59:59Z")
      );
      expect(rangeList.length).toBeGreaterThan(0);

      const clientList = await listClientAppointments(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        clientId
      );
      expect(clientList.length).toBeGreaterThan(0);

      const masterList = await listMasterAppointments(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        master1Id
      );
      expect(masterList.length).toBeGreaterThan(0);
    });
  });

  describe("6. Medical Eligibility and Consent Guards", () => {
    it("allows consultation booking without prior medical clearance or consent", async () => {
      // Consultation doesn't require prior signed consent
      const s1 = parseLocalTimeToUtc("2026-06-24", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-24", "11:00", "Europe/Rome");

      const res = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );
      expect(res.appointment.id).toBeDefined();
    });

    it("blocks procedure booking if client has blocked medical conditions", async () => {
      // Set client medical profile to contraindicated
      await db.insert(s.clientMedicalProfiles).values({
        clientId,
        allergies: "Severe anaphylaxis to pigments",
        contraindications: "Severe keloids and bleeding disorders",
        pregnancyStatus: "pregnant",
        bloodThinners: true,
        medicalNotes: "High risk contraindicated",
      });

      const s1 = parseLocalTimeToUtc("2026-06-25", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-25", "12:00", "Europe/Rome");

      await expect(
        createAppointment(
          db,
          { studioId, userId: ownerUserId, role: "OWNER" },
          {
            clientId,
            masterId: master1Id,
            cycleId,
            serviceId,
            visitKind: "procedure",
            startsAt: s1,
            endsAt: e1,
          }
        )
      ).rejects.toThrow(/medical eligibility/i);
    });
  });

  describe("7. Calendar Visibility & Occupied Intervals", () => {
    it("includes booked appointment as busy interval in Calendar query", async () => {
      const avail = await import("../../src/features/calendar/server/availability");

      const view = await avail.getStudioCalendarView(
        { studioId, userId: ownerUserId },
        { startDate: "2026-06-15", endDate: "2026-06-15" },
        db
      );

      expect(view.masters.length).toBeGreaterThan(0);
      const m1View = view.masters.find((m) => m.master.id === master1Id);
      expect(m1View).toBeDefined();
      expect(m1View!.days[0].occupiedIntervals.length).toBeGreaterThan(0);
    });
  });

  describe("8. Side-Effect Boundaries", () => {
    it("does not mutate cycle stage or create ledger/payment entries", async () => {
      const [cycleBefore] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycleId));

      const s1 = parseLocalTimeToUtc("2026-06-26", "10:00", "Europe/Rome");
      const e1 = parseLocalTimeToUtc("2026-06-26", "11:00", "Europe/Rome");

      const res = await createAppointment(
        db,
        { studioId, userId: ownerUserId, role: "OWNER" },
        {
          clientId,
          masterId: master1Id,
          cycleId,
          serviceId,
          visitKind: "consultation",
          startsAt: s1,
          endsAt: e1,
        }
      );

      const [cycleAfter] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycleId));

      // Stage must remain unchanged
      expect(cycleAfter.stage).toBe(cycleBefore.stage);

      // Payments table must have no records created by booking
      const payments = await db
        .select()
        .from(s.payments)
        .where(eq(s.payments.appointmentId, res.appointment.id));
      expect(payments.length).toBe(0);
    });
  });
});
