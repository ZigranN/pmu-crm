import { describe, expect, it } from "vitest";
import { calculateDailyPaymentReport } from "@/features/ledger/domain/daily-report";
import type { LedgerEntryRecord } from "@/features/ledger/domain/types";
import { getDayBoundsInUtc } from "@/features/calendar/domain/timezone";

describe("Requirement 29: Daily Payment Report Pure Domain Unit Tests", () => {
  it("1. Correctly calculates method breakdowns for cash, card, bank transfer, and other payments", () => {
    const entries: LedgerEntryRecord[] = [
      {
        id: "e-1",
        studioId: "s-1",
        clientId: "c-1",
        type: "PAYMENT",
        amountMinor: 5000, // €50.00 cash deposit
        currency: "EUR",
        paymentMethod: "cash",
        reason: "Acconto deposit cash",
        createdById: "u-1",
        createdAt: "2026-10-30T10:00:00.000Z",
      },
      {
        id: "e-2",
        studioId: "s-1",
        clientId: "c-2",
        type: "PAYMENT",
        amountMinor: 25000, // €250.00 card procedure
        currency: "EUR",
        paymentMethod: "card",
        reason: "Procedure payment card",
        createdById: "u-1",
        createdAt: "2026-10-30T11:00:00.000Z",
      },
      {
        id: "e-3",
        studioId: "s-1",
        clientId: "c-3",
        type: "PAYMENT",
        amountMinor: 10000, // €100.00 bank transfer
        currency: "EUR",
        paymentMethod: "bank_transfer",
        reason: "Bank advance payment",
        createdById: "u-1",
        createdAt: "2026-10-30T12:00:00.000Z",
      },
      {
        id: "e-4",
        studioId: "s-1",
        clientId: "c-4",
        type: "PAYMENT",
        amountMinor: 3000, // €30.00 other / voucher
        currency: "EUR",
        paymentMethod: "other",
        reason: "Gift card payment",
        createdById: "u-1",
        createdAt: "2026-10-30T13:00:00.000Z",
      },
      {
        id: "e-5",
        studioId: "s-1",
        clientId: "c-2",
        type: "REFUND",
        amountMinor: 5000, // €50.00 partial refund
        currency: "EUR",
        reason: "Partial refund",
        createdById: "u-1",
        createdAt: "2026-10-30T14:00:00.000Z",
      },
    ];

    const report = calculateDailyPaymentReport({
      date: "2026-10-30",
      entries,
      clientBalances: [{ clientId: "c-1", outstandingMinor: 15000 }],
      missingProcedures: [{ appointmentId: "a-1", clientId: "c-1", missingAmountMinor: 15000 }],
      pendingAccontos: [{ appointmentId: "a-2", clientId: "c-5", depositAmountMinor: 5000 }],
    });

    expect(report.date).toBe("2026-10-30");
    expect(report.cashMinor).toBe(5000);
    expect(report.cardMinor).toBe(25000);
    expect(report.bankTransferMinor).toBe(10000);
    expect(report.otherMinor).toBe(3000);
    expect(report.totalReceivedMinor).toBe(43000); // 50+250+100+30 = €430.00
    expect(report.totalRefundedMinor).toBe(5000); // €50.00
    expect(report.netReceivedMinor).toBe(38000); // €380.00

    expect(report.unpaidBalancesCount).toBe(1);
    expect(report.unpaidBalancesTotalMinor).toBe(15000);
    expect(report.missingPaymentsCount).toBe(1);
    expect(report.missingPaymentsTotalMinor).toBe(15000);
    expect(report.pendingAccontoCount).toBe(1);
    expect(report.pendingAccontoTotalMinor).toBe(5000);
  });

  it("2. Handles empty entries gracefully with zero totals", () => {
    const report = calculateDailyPaymentReport({
      date: "2026-10-30",
      entries: [],
    });

    expect(report.cashMinor).toBe(0);
    expect(report.cardMinor).toBe(0);
    expect(report.bankTransferMinor).toBe(0);
    expect(report.otherMinor).toBe(0);
    expect(report.totalReceivedMinor).toBe(0);
    expect(report.totalRefundedMinor).toBe(0);
    expect(report.netReceivedMinor).toBe(0);
    expect(report.unpaidBalancesCount).toBe(0);
    expect(report.unpaidBalancesTotalMinor).toBe(0);
    expect(report.missingPaymentsCount).toBe(0);
    expect(report.missingPaymentsTotalMinor).toBe(0);
    expect(report.pendingAccontoCount).toBe(0);
    expect(report.pendingAccontoTotalMinor).toBe(0);
  });

  it("3. Validates amounts and rejects non-integer floats", () => {
    expect(() =>
      calculateDailyPaymentReport({
        date: "2026-10-30",
        entries: [
          {
            id: "e-err",
            studioId: "s-1",
            clientId: "c-1",
            type: "PAYMENT",
            amountMinor: 10.5 as any,
            currency: "EUR",
            reason: "Invalid float",
            createdById: "u-1",
            createdAt: "2026-10-30T10:00:00.000Z",
          },
        ],
      })
    ).toThrow(TypeError);
  });

  it("4. Timezone boundaries: resolves local Studio Rome midnight-to-midnight in UTC", () => {
    const bounds = getDayBoundsInUtc("2026-10-30", "Europe/Rome");
    // Europe/Rome on Oct 30 is UTC+1 (CEST ended last Sunday of Oct) -> 00:00:00 local is 23:00:00 UTC previous day
    expect(bounds.startOfDay.toISOString()).toBe("2026-10-29T23:00:00.000Z");
    expect(bounds.endOfDay.toISOString()).toBe("2026-10-30T22:59:59.999Z");
  });
});
