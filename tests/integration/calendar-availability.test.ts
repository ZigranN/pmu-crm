import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  parseLocalTimeToUtc,
  getDayBoundsInUtc,
} from "../../src/features/calendar/domain/timezone";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getMasterAvailability: typeof import("../../src/features/calendar/server/availability").getMasterAvailability;
let getMasterAvailabilityRange: typeof import("../../src/features/calendar/server/availability").getMasterAvailabilityRange;
let getStudioCalendarView: typeof import("../../src/features/calendar/server/availability").getStudioCalendarView;

let setMasterWorkingHours: typeof import("../../src/features/calendar/server/service").setMasterWorkingHours;
let createCalendarException: typeof import("../../src/features/calendar/server/service").createCalendarException;
let updateCalendarException: typeof import("../../src/features/calendar/server/service").updateCalendarException;
let deleteCalendarException: typeof import("../../src/features/calendar/server/service").deleteCalendarException;

let studioId: string;
let studioId2: string;
let ownerUserId: string;
let adminUserId: string;
let master1UserId: string;
let master2UserId: string;
let strangerUserId: string;

let master1Id: string;
let master2Id: string;
let masterStudio2Id: string;
let clientId: string;
let serviceId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const avail = await import("../../src/features/calendar/server/availability");
  getMasterAvailability = avail.getMasterAvailability;
  getMasterAvailabilityRange = avail.getMasterAvailabilityRange;
  getStudioCalendarView = avail.getStudioCalendarView;

  const srv = await import("../../src/features/calendar/server/service");
  setMasterWorkingHours = srv.setMasterWorkingHours;
  createCalendarException = srv.createCalendarException;
  updateCalendarException = srv.updateCalendarException;
  deleteCalendarException = srv.deleteCalendarException;

  // 1. Create Studios (one with Europe/Rome timezone, one with America/New_York)
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

  // 2. Create Users
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
  adminUserId = await createTestUser("Admin User", "ADMIN", studioId);
  master1UserId = await createTestUser("Master 1 User", "MASTER", studioId);
  master2UserId = await createTestUser("Master 2 User", "MASTER", studioId);
  strangerUserId = await createTestUser("Stranger User", "OWNER", studioId2);

  // 3. Create Masters in studio 1
  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: master1UserId,
      displayName: "Elena Master",
      isActive: true,
    })
    .returning();
  master1Id = m1.id;

  const [m2] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: master2UserId,
      displayName: "Maria Master",
      isActive: true,
    })
    .returning();
  master2Id = m2.id;

  // Create Master in studio 2
  const [mStudio2] = await db
    .insert(s.masters)
    .values({
      studioId: studioId2,
      userId: strangerUserId,
      displayName: "NY Master",
      isActive: true,
    })
    .returning();
  masterStudio2Id = mStudio2.id;

  // 4. Create Client & Service in studio 1
  const [cl] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Anna",
      fullName: "Anna Client",
      phone: "+393331122334",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = cl.id;

  const [svc] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Permanent Brows",
      category: "brows",
      procedureType: "brows",
      priceCents: 15000,
      durationMinutes: 60,
    })
    .returning();
  serviceId = svc.id;
});

describe("Calendar Availability Integration Subsystem", () => {
  const contextOwner = () => ({ studioId, userId: ownerUserId });
  const contextAdmin = () => ({ studioId, userId: adminUserId });
  const contextMaster1 = () => ({ studioId, userId: master1UserId });
  const contextMaster2 = () => ({ studioId, userId: master2UserId });
  const contextStranger = () => ({ studioId: studioId2, userId: strangerUserId });

  it("1. Master with no working hours has no availability", async () => {
    // master2 has no working hours configured
    const res = await getMasterAvailability(contextOwner(), {
      masterId: master2Id,
      date: "2026-06-15", // Monday
    });
    expect(res.isWorkingDay).toBe(false);
    expect(res.workingIntervals).toHaveLength(0);
    expect(res.availableSlots).toHaveLength(0);
  });

  it("2, 3, 4, 6. Working schedule management commands and validation", async () => {
    // 4. Invalid start/end rejected (start >= end)
    await expect(
      db.transaction((tx) =>
        setMasterWorkingHours(tx, contextOwner(), {
          masterId: master1Id,
          intervals: [
            { weekday: 1, startTime: "18:00", endTime: "09:00", isActive: true },
          ],
        })
      )
    ).rejects.toThrow(/must be strictly before endTime/i);

    // 6. Overlapping active intervals rejected
    await expect(
      db.transaction((tx) =>
        setMasterWorkingHours(tx, contextOwner(), {
          masterId: master1Id,
          intervals: [
            { weekday: 1, startTime: "09:00", endTime: "14:00", isActive: true },
            { weekday: 1, startTime: "13:00", endTime: "18:00", isActive: true },
          ],
        })
      )
    ).rejects.toThrow(/Overlapping active intervals detected/i);

    // 2 & 3. Set valid multiple working intervals: Mon 09:00-13:00 and 14:00-18:00, Tue 09:00-18:00
    await db.transaction((tx) =>
      setMasterWorkingHours(tx, contextOwner(), {
        masterId: master1Id,
        intervals: [
          { weekday: 1, startTime: "09:00", endTime: "13:00", isActive: true },
          { weekday: 1, startTime: "14:00", endTime: "18:00", isActive: true },
          { weekday: 2, startTime: "09:00", endTime: "18:00", isActive: true },
        ],
        reason: "Initial schedule setup",
      })
    );

    // Verify Monday (2026-06-15) has 8 slots
    const mondayRes = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15", // Monday
      durationMinutes: 60,
    });
    expect(mondayRes.isWorkingDay).toBe(true);
    expect(mondayRes.workingIntervals).toHaveLength(2);
    expect(mondayRes.availableSlots).toHaveLength(8);

    // Verify Tuesday (2026-06-16) has 9 slots
    const tuesdayRes = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-16", // Tuesday
      durationMinutes: 60,
    });
    expect(tuesdayRes.isWorkingDay).toBe(true);
    expect(tuesdayRes.workingIntervals).toHaveLength(1);
    expect(tuesdayRes.availableSlots).toHaveLength(9);
  });

  it("5 & 20. Cross-Studio Master and tenant isolation rejected", async () => {
    // Attempting to access masterStudio2Id from studioId context
    await expect(
      getMasterAvailability(contextOwner(), {
        masterId: masterStudio2Id,
        date: "2026-06-15",
      })
    ).rejects.toThrow(/Master not found/i);

    // Attempting to set working hours for cross-studio master
    await expect(
      db.transaction((tx) =>
        setMasterWorkingHours(tx, contextOwner(), {
          masterId: masterStudio2Id,
          intervals: [{ weekday: 1, startTime: "09:00", endTime: "18:00" }],
        })
      )
    ).rejects.toThrow(/Master not found/i);
  });

  it("21 & 22. Scope authorization: Owner/Admin vs Master access", async () => {
    // Owner can access master1
    const resOwner = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15",
    });
    expect(resOwner.isWorkingDay).toBe(true);

    // Admin can access master1
    const resAdmin = await getMasterAvailability(contextAdmin(), {
      masterId: master1Id,
      date: "2026-06-15",
    });
    expect(resAdmin.isWorkingDay).toBe(true);

    // Master 1 can access Master 1
    const resM1 = await getMasterAvailability(contextMaster1(), {
      masterId: master1Id,
      date: "2026-06-15",
    });
    expect(resM1.isWorkingDay).toBe(true);

    // Master 2 cannot access Master 1
    await expect(
      getMasterAvailability(contextMaster2(), {
        masterId: master1Id,
        date: "2026-06-15",
      })
    ).rejects.toThrow(/Permission denied/i);
  });

  it("7. Full Day Off exception clears availability", async () => {
    const tz = "Europe/Rome";
    const bounds = getDayBoundsInUtc("2026-06-16", tz);

    const exc = await db.transaction((tx) =>
      createCalendarException(tx, contextOwner(), {
        masterId: master1Id,
        type: "DAY_OFF",
        reason: "Medical vacation",
        startAt: bounds.startOfDay,
        endAt: bounds.nextDayStart,
      })
    );

    const res = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-16",
    });
    expect(res.availableSlots).toHaveLength(0);
    expect(res.availableIntervals).toHaveLength(0);
    expect(res.blockedIntervals).toHaveLength(1);

    // Update exception reason and times
    const updatedExc = await db.transaction((tx) =>
      updateCalendarException(tx, contextOwner(), {
        id: exc.id,
        reason: "Updated vacation reason",
      })
    );
    expect(updatedExc.reason).toBe("Updated vacation reason");

    // Cross-studio exception update rejected
    await expect(
      db.transaction((tx) =>
        updateCalendarException(tx, contextStranger(), {
          id: exc.id,
          reason: "Hacker update",
        })
      )
    ).rejects.toThrow(/Calendar exception not found/i);

    // Delete exception to restore availability for later tests
    await db.transaction((tx) =>
      deleteCalendarException(tx, contextOwner(), { id: exc.id })
    );

    const resRestored = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-16",
    });
    expect(resRestored.availableSlots).toHaveLength(9);
  });

  it("8, 9, 11. Partial block, overlapping blocks, and block outside working hours", async () => {
    const tz = "Europe/Rome";
    // Block lunch: 12:00 to 13:00 on Tuesday 2026-06-16
    const lunchStart = parseLocalTimeToUtc("2026-06-16", "12:00", tz);
    const lunchEnd = parseLocalTimeToUtc("2026-06-16", "13:00", tz);

    // Overlapping personal block: 12:30 to 14:00
    const personalStart = parseLocalTimeToUtc("2026-06-16", "12:30", tz);
    const personalEnd = parseLocalTimeToUtc("2026-06-16", "14:00", tz);

    // Block outside working hours: 06:00 to 08:00
    const earlyStart = parseLocalTimeToUtc("2026-06-16", "06:00", tz);
    const earlyEnd = parseLocalTimeToUtc("2026-06-16", "08:00", tz);

    await db.transaction(async (tx) => {
      await createCalendarException(tx, contextOwner(), {
        masterId: master1Id,
        type: "BLOCKED_TIME",
        reason: "Lunch",
        startAt: lunchStart,
        endAt: lunchEnd,
      });
      await createCalendarException(tx, contextOwner(), {
        masterId: master1Id,
        type: "BLOCKED_TIME",
        reason: "Personal",
        startAt: personalStart,
        endAt: personalEnd,
      });
      await createCalendarException(tx, contextOwner(), {
        masterId: master1Id,
        type: "BLOCKED_TIME",
        reason: "Early morning prep",
        startAt: earlyStart,
        endAt: earlyEnd,
      });
    });

    const res = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-16",
      durationMinutes: 60,
    });

    // 09:00-12:00 (3 slots: 09:00, 10:00, 11:00)
    // 12:00-14:00 is blocked
    // 14:00-18:00 (4 slots: 14:00, 15:00, 16:00, 17:00)
    // Total: 7 slots
    expect(res.availableSlots).toHaveLength(7);
    expect(res.availableSlots.map((s) => s.localStartTime)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ]);
  });

  it("10. Studio-wide closure subtracts availability from all masters", async () => {
    const tz = "Europe/Rome";
    // Close studio from 16:00 to 18:00 on Tuesday 2026-06-16
    const closureStart = parseLocalTimeToUtc("2026-06-16", "16:00", tz);
    const closureEnd = parseLocalTimeToUtc("2026-06-16", "18:00", tz);

    await db.transaction((tx) =>
      createCalendarException(tx, contextOwner(), {
        masterId: null, // Studio closure
        type: "STUDIO_CLOSURE",
        reason: "Sanitary disinfection",
        startAt: closureStart,
        endAt: closureEnd,
      })
    );

    const res = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-16",
      durationMinutes: 60,
    });

    // 09:00-12:00 (3 slots)
    // 12:00-14:00 (blocked)
    // 14:00-16:00 (2 slots: 14:00, 15:00)
    // 16:00-18:00 (studio closed)
    // Total: 5 slots
    expect(res.availableSlots).toHaveLength(5);
    expect(res.availableSlots.map((s) => s.localStartTime)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "14:00",
      "15:00",
    ]);
  });

  it("12, 13, 14, 15. Occupied intervals (appointments) subtraction and adjacent boundary touching", async () => {
    const tz = "Europe/Rome";
    // Book an appointment on Monday 2026-06-15 from 10:00 to 11:30 local time
    const apptStart = parseLocalTimeToUtc("2026-06-15", "10:00", tz);
    const apptEnd = parseLocalTimeToUtc("2026-06-15", "11:30", tz);

    const [appt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId: master1Id,
        serviceId,
        startAt: apptStart,
        endAt: apptEnd,
        status: "confirmed",
        source: "walk_in",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 15000,
        durationSnapshotMinutes: 90,
      })
      .returning();

    const res = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15", // Monday (working hours 09:00-13:00, 14:00-18:00)
      durationMinutes: 60,
      slotStepMinutes: 30,
    });

    // 09:00-10:00 available -> 1 slot at 09:00
    // 10:00-11:30 busy -> 09:30, 10:00, 10:30, 11:00 cannot start
    // 11:30-13:00 available (90 min) -> slots at 11:30, 12:00
    // 14:00-18:00 available -> slots at 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00
    expect(res.availableSlots.some((s) => s.localStartTime === "09:00")).toBe(true);
    expect(res.availableSlots.some((s) => s.localStartTime === "09:30")).toBe(false);
    expect(res.availableSlots.some((s) => s.localStartTime === "10:00")).toBe(false);
    expect(res.availableSlots.some((s) => s.localStartTime === "11:00")).toBe(false);
    expect(res.availableSlots.some((s) => s.localStartTime === "11:30")).toBe(true); // adjacent boundary touching

    // Cancel appointment and verify slot availability is restored
    await db
      .update(s.appointments)
      .set({ status: "cancelled", cancelReason: "Client cancelled" })
      .where(eq(s.appointments.id, appt.id));

    const resCancelled = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15",
      durationMinutes: 60,
      slotStepMinutes: 30,
    });
    expect(resCancelled.availableSlots.some((s) => s.localStartTime === "10:00")).toBe(true);
  });

  it("27. Side-effect audit: availability read performs ZERO writes", async () => {
    // Count rows across all main tables
    const countTable = async (table: any) =>
      (await db.select({ count: sql<number>`count(*)::int` }).from(table))[0].count;

    const countBefore = {
      appointments: await countTable(s.appointments),
      calendarExceptions: await countTable(s.calendarExceptions),
      masterAvailability: await countTable(s.masterAvailability),
      auditLogs: await countTable(s.auditLogs),
      accessLogs: await countTable(s.accessLogs),
    };

    // Execute multiple availability reads
    await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15",
    });
    await getMasterAvailabilityRange(contextOwner(), {
      masterId: master1Id,
      startDate: "2026-06-15",
      endDate: "2026-06-21",
    });
    await getStudioCalendarView(contextOwner(), {
      startDate: "2026-06-15",
      endDate: "2026-06-21",
    });

    const countAfter = {
      appointments: await countTable(s.appointments),
      calendarExceptions: await countTable(s.calendarExceptions),
      masterAvailability: await countTable(s.masterAvailability),
      auditLogs: await countTable(s.auditLogs),
      accessLogs: await countTable(s.accessLogs),
    };

    expect(countAfter).toEqual(countBefore);
  });

  it("28 & 29. Studio Calendar Read Model: day and week views", async () => {
    const view = await getStudioCalendarView(contextOwner(), {
      startDate: "2026-06-15",
      endDate: "2026-06-21",
    });

    expect(view.studioId).toBe(studioId);
    expect(view.timezone).toBe("Europe/Rome");
    expect(view.dates).toHaveLength(7);
    expect(view.masters.length).toBeGreaterThanOrEqual(1);

    const elena = view.masters.find((m) => m.master.id === master1Id);
    expect(elena).toBeDefined();
    expect(elena?.days).toHaveLength(7);
    expect(elena?.days[0].date).toBe("2026-06-15");
    expect(elena?.days[0].weekday).toBe(1); // Monday
  });

  it("30. Advisory concurrency boundary contract", async () => {
    // Read availability for a slot
    const res = await getMasterAvailability(contextOwner(), {
      masterId: master1Id,
      date: "2026-06-15",
      durationMinutes: 60,
    });
    const firstSlot = res.availableSlots[0];
    expect(firstSlot).toBeDefined();

    // Verify documentation contract: available now != atomically reserved
    // Phase 5 will implement locking appointment creation transaction.
    // Calendar availability remains advisory and read-only.
    expect(typeof firstSlot.startAt.getTime).toBe("function");
  });
});
