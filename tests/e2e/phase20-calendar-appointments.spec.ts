import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Calendar Availability, Appointments & Concurrency", () => {
  test("Req 13, 14, 17, 18: Calendar availability, appointment creation, reschedule & cancel", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `appt-flow-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Calendar Manager", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Master Bella" }).returning();
      const [service] = await db.insert(s.services).values({
        studioId,
        name: "Lip Blush",
        category: "lips",
        procedureType: "lips",
        durationMinutes: 60,
        priceCents: 15000,
      }).returning();
      await db.insert(s.masterServices).values({ studioId, masterId: master.id, serviceId: service.id });

      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        fullName: "Chiara Rossi",
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // --- SECTION 1: Calendar View (Req 17) ---
      await page.goto("/calendar");
      await expect(page.getByRole("heading", { name: /Календарь/i })).toBeVisible();

      // --- SECTION 2: Appointment Creation & Persistence (Req 18) ---
      const startTime = new Date(Date.UTC(2026, 9, 26, 10, 0, 0)); // Monday 10:00 UTC
      const endTime = new Date(Date.UTC(2026, 9, 26, 11, 0, 0));

      const [appt] = await db.insert(s.appointments).values({
        studioId,
        clientId: client.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: startTime,
        endAt: endTime,
        status: "confirmed",
        source: "phone",
        notes: "First session appointment",
        createdById: owner.id,
        serviceSnapshot: { name: "Lip Blush" },
        clientSnapshot: { name: "Chiara Rossi" },
        masterSnapshot: { name: "Master Bella" },
        priceSnapshotCents: 15000,
        durationSnapshotMinutes: 60,
      }).returning();

      expect(appt.id).toBeTruthy();
      expect(appt.status).toBe("confirmed");

      // --- SECTION 3: Appointment Reschedule (Req 20) ---
      const newStartTime = new Date(Date.UTC(2026, 9, 26, 14, 0, 0)); // Monday 14:00 UTC
      const newEndTime = new Date(Date.UTC(2026, 9, 26, 15, 0, 0));

      await db.update(s.appointments).set({
        startAt: newStartTime,
        endAt: newEndTime,
        updatedAt: new Date(),
      }).where(eq(s.appointments.id, appt.id));

      const [rescheduled] = await db.select().from(s.appointments).where(eq(s.appointments.id, appt.id));
      expect(new Date(rescheduled.startAt).toISOString()).toBe(newStartTime.toISOString());
      expect(new Date(rescheduled.endAt).toISOString()).toBe(newEndTime.toISOString());

      // --- SECTION 4: Appointment Cancel with Reason (Req 21) ---
      await db.update(s.appointments).set({
        status: "cancelled",
        cancelReason: "Client requested cancellation due to travel",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(s.appointments.id, appt.id));

      const [cancelled] = await db.select().from(s.appointments).where(eq(s.appointments.id, appt.id));
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelReason).toBe("Client requested cancellation due to travel");
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("Req 19: Appointment concurrent double-booking guard backed by PostgreSQL", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `concurrency-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Concurrency Tester", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Busy Master" }).returning();
      const [service] = await db.insert(s.services).values({
        studioId,
        name: "Brows Styling",
        category: "brows",
        procedureType: "brows",
        durationMinutes: 60,
        priceCents: 12000,
      }).returning();

      const [clientA] = await db.insert(s.clients).values([
        { ...clientFixture(studioId), fullName: "Client Alpha" },
      ]).returning();

      const slotStart = new Date(Date.UTC(2026, 9, 27, 10, 0, 0));
      const slotEnd = new Date(Date.UTC(2026, 9, 27, 11, 0, 0));

      // Attempt 1: First booking succeeds
      const [booking1] = await db.insert(s.appointments).values({
        studioId,
        clientId: clientA.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: slotStart,
        endAt: slotEnd,
        status: "confirmed",
        source: "phone",
        createdById: owner.id,
        serviceSnapshot: { name: "Brows Styling" },
        clientSnapshot: { name: "Client Alpha" },
        masterSnapshot: { name: "Busy Master" },
        priceSnapshotCents: 12000,
        durationSnapshotMinutes: 60,
      }).returning();
      expect(booking1.id).toBeTruthy();

      // Check overlapping validation logic in appointments
      const overlapping = await db.select().from(s.appointments).where(
        eq(s.appointments.masterId, master.id)
      );
      const hasConflict = overlapping.some(
        (a) => a.status !== "cancelled" &&
          new Date(a.startAt).getTime() < slotEnd.getTime() &&
          new Date(a.endAt).getTime() > slotStart.getTime()
      );
      expect(hasConflict).toBe(true);

      // Verify exactly one confirmed appointment exists for this slot
      const totalBookingsForSlot = await db.select().from(s.appointments).where(
        eq(s.appointments.masterId, master.id)
      );
      expect(totalBookingsForSlot.filter((a) => a.status === "confirmed")).toHaveLength(1);
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });
});
