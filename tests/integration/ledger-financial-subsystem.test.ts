import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  recordCharge,
  recordPayment,
  recordRefund,
  recordAdjustment,
  getClientFinancialSummary,
  getAppointmentFinancialSummary,
} from "@/features/ledger/server/service";
import { fetchDailyPaymentReportInternal } from "@/features/ledger/server/queries";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: any;

let studioId: string;
let foreignStudioId: string;
let ownerUserId: string;
let foreignOwnerUserId: string;
let adminUserId: string;
let masterUserId: string;
let clientUserId: string;

let clientId: string;
let foreignClientId: string;
let masterId: string;
let serviceId: string;
let cycleId: string;
let appointmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;

  // Insert studio 1
  const [studio] = await db
    .insert(s.studios)
    .values(studioFixture())
    .returning();
  studioId = studio.id;

  // Insert studio 2 (for tenant isolation tests)
  const [foreignStudio] = await db
    .insert(s.studios)
    .values(studioFixture())
    .returning();
  foreignStudioId = foreignStudio.id;

  // Roles map
  const roles = await db.select().from(s.roles);
  const ownerRoleId = roles.find((r: any) => r.code === "OWNER" || r.code === "STUDIO_ADMIN")!.id;
  const adminRoleId = roles.find((r: any) => r.code === "ADMIN" || r.code === "ASSISTANT")!.id;
  const masterRoleId = roles.find((r: any) => r.code === "MASTER")!.id;

  // Users
  ownerUserId = randomUUID();
  foreignOwnerUserId = randomUUID();
  adminUserId = randomUUID();
  masterUserId = randomUUID();
  clientUserId = randomUUID();

  await db.insert(s.user).values([
    { id: ownerUserId, name: "Studio Owner", email: `${ownerUserId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: foreignOwnerUserId, name: "Foreign Studio Owner", email: `${foreignOwnerUserId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: adminUserId, name: "Studio Admin", email: `${adminUserId}@example.test`, role: "ASSISTANT", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: masterUserId, name: "Master User", email: `${masterUserId}@example.test`, role: "MASTER", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: clientUserId, name: "Client User", email: `${clientUserId}@example.test`, role: "CLIENT", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
  ]);

  // Studio Members
  await db.insert(s.studioMembers).values([
    { studioId, userId: ownerUserId, roleId: ownerRoleId, isActive: true },
    { studioId: foreignStudioId, userId: foreignOwnerUserId, roleId: ownerRoleId, isActive: true },
    { studioId, userId: adminUserId, roleId: adminRoleId, isActive: true },
    { studioId, userId: masterUserId, roleId: masterRoleId, isActive: true },
  ]);

  // Master profile
  const [master] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: masterUserId,
      displayName: "Master Anna",
      isActive: true,
    })
    .returning();
  masterId = master.id;

  // Clients
  const [client] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Maria",
      lastName: "Ivanova",
      fullName: "Maria Ivanova",
      phone: "+393330001111",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = client.id;

  const [foreignClient] = await db
    .insert(s.clients)
    .values({
      studioId: foreignStudioId,
      firstName: "Foreign",
      lastName: "Client",
      fullName: "Foreign Client",
      phone: "+393330002222",
      clientStatus: "new_lead",
    })
    .returning();
  foreignClientId = foreignClient.id;

  // Service
  const [service] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Brows Microblading",
      category: "brows",
      procedureType: "brows",
      priceCents: 25000, // €250.00
      durationMinutes: 120,
      priceMode: "fixed",
    })
    .returning();
  serviceId = service.id;

  // Treatment Cycle
  const [cycle] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "consultation_scheduled",
    })
    .returning();
  cycleId = cycle.id;

  // Appointment
  const [appt] = await db
    .insert(s.appointments)
    .values({
      studioId,
      clientId,
      masterId,
      serviceId,
      startAt: new Date("2026-07-01T10:00:00Z"),
      endAt: new Date("2026-07-01T12:00:00Z"),
      status: "confirmed",
      source: "other",
      createdById: ownerUserId,
      serviceSnapshot: { name: "Brows Microblading", priceCents: 25000 },
      clientSnapshot: { fullName: "Maria Ivanova", phone: "+393330001111" },
      masterSnapshot: { displayName: "Master Anna" },
      priceSnapshotCents: 25000,
      durationSnapshotMinutes: 120,
    })
    .returning();
  appointmentId = appt.id;

  await db.insert(s.appointmentCycles).values({
    studioId,
    clientId,
    appointmentId,
    cycleId,
    visitKind: "consultation",
    serviceSnapshot: { name: "Brows Microblading", priceCents: 25000 },
  });
});

afterAll(async () => {
  if (database) {
    await database.close();
  }
});

describe("Phase 6: Ledger Subsystem Integration Tests", () => {
  describe("1. Money Correctness & Schema Rules", () => {
    it("persists integer minor units and respects positive rules", async () => {
      const charge = await recordCharge(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          appointmentId,
          amountMinor: 25000,
          currency: "EUR",
          reason: "Procedure obligation: Brows Microblading",
        }
      );

      expect(charge.id).toBeDefined();
      expect(charge.amountMinor).toBe(25000);
      expect(charge.type).toBe("CHARGE");
      expect(charge.currency).toBe("EUR");

      // Zero amount should be rejected by schema
      await expect(
        recordCharge(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId,
            amountMinor: 0,
            currency: "EUR",
            reason: "Invalid zero charge",
          }
        )
      ).rejects.toThrow();

      // Negative charge amount should be rejected by schema
      await expect(
        recordCharge(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId,
            amountMinor: -100,
            currency: "EUR",
            reason: "Invalid negative charge",
          }
        )
      ).rejects.toThrow();
    });
  });

  describe("2. Payments, Partial Payments & Overpayments", () => {
    it("persists partial payment and updates derived balance", async () => {
      const payment1 = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          appointmentId,
          amountMinor: 10000, // €100.00
          currency: "EUR",
          paymentMethod: "card",
          reason: "Partial deposit payment",
        }
      );

      expect(payment1.type).toBe("PAYMENT");
      expect(payment1.amountMinor).toBe(10000);

      const { summary } = await getClientFinancialSummary(
        db,
        { studioId, userId: ownerUserId },
        clientId
      );

      expect(summary.totalCharges).toBe(25000);
      expect(summary.totalPayments).toBe(10000);
      expect(summary.outstanding).toBe(15000); // 250.00 - 100.00 = 150.00
      expect(summary.credit).toBe(0);
    });

    it("supports second partial payment reaching full payment", async () => {
      const payment2 = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          appointmentId,
          amountMinor: 15000, // €150.00
          currency: "EUR",
          paymentMethod: "cash",
          reason: "Remaining balance payment",
        }
      );

      expect(payment2.amountMinor).toBe(15000);

      const { summary } = await getClientFinancialSummary(
        db,
        { studioId, userId: ownerUserId },
        clientId
      );

      expect(summary.totalCharges).toBe(25000);
      expect(summary.totalPayments).toBe(25000);
      expect(summary.netPaid).toBe(25000);
      expect(summary.outstanding).toBe(0);
      expect(summary.credit).toBe(0);
    });

    it("supports overpayment creating client credit", async () => {
      const paymentTip = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 5000, // €50.00 deposit/prepayment
          currency: "EUR",
          paymentMethod: "bank_transfer",
          reason: "Future touch-up prepayment",
        }
      );

      expect(paymentTip.amountMinor).toBe(5000);

      const { summary } = await getClientFinancialSummary(
        db,
        { studioId, userId: ownerUserId },
        clientId
      );

      expect(summary.totalCharges).toBe(25000);
      expect(summary.totalPayments).toBe(30000);
      expect(summary.netPaid).toBe(30000);
      expect(summary.outstanding).toBe(0);
      expect(summary.credit).toBe(5000); // 50 EUR credit
    });
  });

  describe("3. Immutability & Trigger Protection", () => {
    it("forbids direct UPDATE of amount or reason on posted ledger entries", async () => {
      const [entry] = await db
        .select()
        .from(s.ledgerEntries)
        .where(eq(s.ledgerEntries.clientId, clientId))
        .limit(1);

      expect(entry).toBeDefined();

      // Attempting to update amount_minor directly in SQL must throw immutable exception
      try {
        await db
          .update(s.ledgerEntries)
          .set({ amountMinor: 999999 })
          .where(eq(s.ledgerEntries.id, entry.id));
        expect.unreachable("Direct update should have been rejected by immutability trigger");
      } catch (err: any) {
        expect(err.message + (err.cause?.message || "")).toMatch(/immutable|failed query/i);
      }
    });

    it("forbids direct DELETE of posted ledger entries", async () => {
      const [entry] = await db
        .select()
        .from(s.ledgerEntries)
        .where(eq(s.ledgerEntries.clientId, clientId))
        .limit(1);

      expect(entry).toBeDefined();

      // Attempting to delete ledger row directly in SQL must throw immutable exception
      try {
        await db
          .delete(s.ledgerEntries)
          .where(eq(s.ledgerEntries.id, entry.id));
        expect.unreachable("Direct delete should have been rejected by immutability trigger");
      } catch (err: any) {
        expect(err.message + (err.cause?.message || "")).toMatch(/immutable|failed query/i);
      }
    });
  });

  describe("4. Refunds & Over-Refund Rejection", () => {
    let specificPaymentId: string;

    it("records a valid partial refund referencing a specific payment entry", async () => {
      // Find the €150.00 payment
      const [payment] = await db
        .select()
        .from(s.ledgerEntries)
        .where(
          and(
            eq(s.ledgerEntries.clientId, clientId),
            eq(s.ledgerEntries.type, "PAYMENT"),
            eq(s.ledgerEntries.amountMinor, 15000)
          )
        );

      expect(payment).toBeDefined();
      specificPaymentId = payment.id;

      const refund = await recordRefund(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          targetPaymentId: specificPaymentId,
          amountMinor: 5000, // €50.00
          currency: "EUR",
          reason: "Partial refund for discounted session",
        }
      );

      expect(refund.type).toBe("REFUND");
      expect(refund.amountMinor).toBe(5000);
      expect(refund.targetPaymentId).toBe(specificPaymentId);
    });

    it("rejects over-refund exceeding the specific payment remaining refundable balance", async () => {
      // The payment was 15000, 5000 was refunded, remaining is 10000.
      // Trying to refund 12000 must fail!
      await expect(
        recordRefund(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId,
            targetPaymentId: specificPaymentId,
            amountMinor: 12000,
            currency: "EUR",
            reason: "Over-refund attempt",
          }
        )
      ).rejects.toThrow(/over-refund rejected/i);
    });

    it("allows full refund of the remaining balance of the payment", async () => {
      const finalRefund = await recordRefund(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          targetPaymentId: specificPaymentId,
          amountMinor: 10000, // €100.00
          currency: "EUR",
          reason: "Refund remaining portion",
        }
      );

      expect(finalRefund.amountMinor).toBe(10000);

      // Now remaining is 0, any subsequent refund on this payment must fail
      await expect(
        recordRefund(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId,
            targetPaymentId: specificPaymentId,
            amountMinor: 100,
            currency: "EUR",
            reason: "Attempt refund on fully refunded payment",
          }
        )
      ).rejects.toThrow(/over-refund rejected/i);
    });
  });

  describe("5. Financial Adjustments", () => {
    it("records authorized manual adjustment with required reason", async () => {
      const adjustment = await recordAdjustment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          appointmentId,
          amountMinor: -3000, // -€30.00 discount adjustment
          currency: "EUR",
          reason: "VIP client loyalty waiver",
        }
      );

      expect(adjustment.type).toBe("ADJUSTMENT");
      expect(adjustment.amountMinor).toBe(-3000);
      expect(adjustment.reason).toBe("VIP client loyalty waiver");
    });
  });

  describe("6. Idempotency Protection", () => {
    it("returns existing ledger entry on duplicate payment request with same idempotency key", async () => {
      const idempotencyKey = randomUUID();

      const pay1 = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 7500,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Idempotent payment test",
          idempotencyKey,
        }
      );

      const pay2 = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 7500,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Idempotent payment test",
          idempotencyKey,
        }
      );

      expect(pay1.id).toBe(pay2.id);

      // Count in DB for this commandId must be exactly 1
      const count = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(s.ledgerEntries)
        .where(eq(s.ledgerEntries.commandId, idempotencyKey));

      expect(count[0].count).toBe(1);
    });

    it("rejects request if same idempotency key is reused with different payload", async () => {
      const idempotencyKey = randomUUID();

      await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 5000,
          currency: "EUR",
          reason: "First payload",
          idempotencyKey,
        }
      );

      await expect(
        recordPayment(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId,
            amountMinor: 9000, // Changed amount
            currency: "EUR",
            reason: "Modified payload",
            idempotencyKey,
          }
        )
      ).rejects.toThrow(/mismatch/i);
    });
  });

  describe("7. Tenant Isolation & Permissions", () => {
    it("rejects cross-studio financial mutations", async () => {
      // Trying to record payment in Studio 1 for a client in Studio 2
      await expect(
        recordPayment(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId: foreignClientId,
            amountMinor: 5000,
            currency: "EUR",
            reason: "Cross studio attempt",
          }
        )
      ).rejects.toThrow(/Client not found in this studio/i);
    });

    it("rejects unauthorized MASTER from recording financial adjustments or refunds", async () => {
      await expect(
        recordAdjustment(
          db,
          { studioId, userId: masterUserId },
          {
            clientId,
            amountMinor: -1000,
            currency: "EUR",
            reason: "Master unauthorized adjustment",
          }
        )
      ).rejects.toThrow(/Permission denied/i);

      await expect(
        recordRefund(
          db,
          { studioId, userId: masterUserId },
          {
            clientId,
            amountMinor: 1000,
            currency: "EUR",
            reason: "Master unauthorized refund",
          }
        )
      ).rejects.toThrow(/Permission denied/i);
    });
  });

  describe("8. Appointment Financial Summary & History", () => {
    it("returns appointment financial summary matching price snapshot and ledger entries", async () => {
      const apptSummary = await getAppointmentFinancialSummary(
        db,
        { studioId, userId: ownerUserId },
        appointmentId
      );

      expect(apptSummary.expectedPriceCents).toBe(25000);
      expect(apptSummary.entries.length).toBeGreaterThan(0);
      expect(apptSummary.paidAmountCents).toBeGreaterThan(0);
    });

    it("preserves historical appointment financial snapshot if future service price changes", async () => {
      // Update catalog service price
      await db
        .update(s.services)
        .set({ priceCents: 99000 })
        .where(eq(s.services.id, serviceId));

      const apptSummary = await getAppointmentFinancialSummary(
        db,
        { studioId, userId: ownerUserId },
        appointmentId
      );

      // Historical appointment priceSnapshot remains €250.00 (25000 cents), unaffected by catalog update!
      expect(apptSummary.expectedPriceCents).toBe(25000);
    });
  });

  describe("9. Side-Effect Boundaries", () => {
    it("verifies payment does not mutate cycle stage or medical/consent records", async () => {
      const [cycleBefore] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycleId));

      await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          cycleId,
          amountMinor: 1000,
          currency: "EUR",
          reason: "Boundary side-effect check payment",
        }
      );

      const [cycleAfter] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycleId));

      expect(cycleAfter.stage).toBe(cycleBefore.stage);
      expect(cycleAfter.suspendedAt).toEqual(cycleBefore.suspendedAt);
      expect(cycleAfter.completedAt).toEqual(cycleBefore.completedAt);
    });
  });

  describe("10. PostgreSQL Concurrency Race Test", () => {
    it("allows exactly ONE refund when two concurrent transactions attempt over-refund simultaneously", async () => {
      // 1. Create a fresh client and a payment of €100.00 (10000 cents)
      const [raceClient] = await db
        .insert(s.clients)
        .values({
          studioId,
          firstName: "Race",
          lastName: "Test",
          fullName: "Race Test",
          phone: "+393339998888",
          clientStatus: "new_lead",
        })
        .returning();

      const racePayment = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId: raceClient.id,
          amountMinor: 10000, // €100.00
          currency: "EUR",
          reason: "Payment for concurrency race test",
        }
      );

      // 2. Launch two concurrent refund attempts of €70.00 (7000 cents) each.
      // Total requested is €140.00 > €100.00 payment.
      // Because of PostgreSQL row locking in recordRefund, exactly one must succeed and one must fail!
      const results = await Promise.allSettled([
        recordRefund(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId: raceClient.id,
            targetPaymentId: racePayment.id,
            amountMinor: 7000,
            currency: "EUR",
            reason: "Concurrent refund Tx A",
          }
        ),
        recordRefund(
          db,
          { studioId, userId: ownerUserId },
          {
            clientId: raceClient.id,
            targetPaymentId: racePayment.id,
            amountMinor: 7000,
            currency: "EUR",
            reason: "Concurrent refund Tx B",
          }
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Verify final refunds in DB
      const refunds = await db
        .select()
        .from(s.ledgerEntries)
        .where(
          and(
            eq(s.ledgerEntries.clientId, raceClient.id),
            eq(s.ledgerEntries.type, "REFUND")
          )
        );

      expect(refunds.length).toBe(1);
      expect(refunds[0].amountMinor).toBe(7000);
    });
  });

  describe("11. Requirement 29: Daily Payment Report Database Aggregations & Tenant Isolation", () => {
    it("aggregates daily payment methods and respects tenant boundaries", async () => {
      // Create payments across methods for studioId
      await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 5000,
          currency: "EUR",
          paymentMethod: "cash",
          reason: "Cash acconto",
        }
      );

      await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 20000,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Card payment",
        }
      );

      await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 15000,
          currency: "EUR",
          paymentMethod: "bank_transfer",
          reason: "Bank transfer",
        }
      );

      // Create a foreign studio payment
      await recordPayment(
        db,
        { studioId: foreignStudioId, userId: foreignOwnerUserId },
        {
          clientId: foreignClientId,
          amountMinor: 99000,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Foreign studio card payment",
        }
      );

      const report = await fetchDailyPaymentReportInternal(studioId, new Date(), db);

      expect(report.cashMinor).toBeGreaterThanOrEqual(5000);
      expect(report.cardMinor).toBeGreaterThanOrEqual(20000);
      expect(report.bankTransferMinor).toBeGreaterThanOrEqual(15000);
      expect(report.totalReceivedMinor).toBe(
        report.cashMinor + report.cardMinor + report.bankTransferMinor + report.otherMinor
      );
      // Foreign studio payment must NOT be included in studio report
      expect(report.cardMinor).toBeLessThan(99000);

      // Foreign studio report check
      const foreignReport = await fetchDailyPaymentReportInternal(foreignStudioId, new Date(), db);
      expect(foreignReport.cardMinor).toBe(99000);
      expect(foreignReport.cashMinor).toBe(0);
    });

    it("verifies payment idempotency using idempotencyKey / commandId", async () => {
      const idempotencyKey = randomUUID();
      const firstEntry = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 7500,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Idempotent payment test",
          idempotencyKey,
        }
      );

      // Replay with identical idempotencyKey
      const secondEntry = await recordPayment(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId,
          amountMinor: 7500,
          currency: "EUR",
          paymentMethod: "card",
          reason: "Idempotent payment test duplicate",
          idempotencyKey,
        }
      );

      expect(secondEntry.id).toBe(firstEntry.id);
      expect(secondEntry.amountMinor).toBe(7500);

      // Ensure no duplicate rows were inserted
      const rows = await db
        .select()
        .from(s.ledgerEntries)
        .where(
          and(
            eq(s.ledgerEntries.studioId, studioId),
            eq(s.ledgerEntries.commandId, idempotencyKey)
          )
        );
      expect(rows.length).toBe(1);
    });
  });
});
