import { describe, expect, it } from "vitest";
import { calculateLedgerBalance } from "@/features/ledger/domain/balance";
import type { LedgerEntryRecord } from "@/features/ledger/domain/types";

describe("Phase 6: Pure Ledger Balance & Money Domain", () => {
  it("1. calculates financial balance using integer minor units (cents)", () => {
    const entries: LedgerEntryRecord[] = [
      {
        id: "entry-1",
        studioId: "studio-1",
        clientId: "client-1",
        type: "CHARGE",
        amountMinor: 199000, // €1990.00
        currency: "EUR",
        reason: "Initial procedure charge",
        createdById: "user-1",
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      {
        id: "entry-2",
        studioId: "studio-1",
        clientId: "client-1",
        type: "PAYMENT",
        amountMinor: 50000, // €500.00
        currency: "EUR",
        reason: "Deposit payment",
        paymentMethod: "card",
        createdById: "user-1",
        createdAt: "2026-06-01T10:05:00.000Z",
      },
    ];

    const result = calculateLedgerBalance(entries);

    expect(result.totalCharges).toBe(199000);
    expect(result.totalPayments).toBe(50000);
    expect(result.totalRefunds).toBe(0);
    expect(result.totalAdjustments).toBe(0);
    expect(result.netPaid).toBe(50000);
    expect(result.netCharges).toBe(199000);
    expect(result.outstanding).toBe(149000); // 199000 - 50000
    expect(result.credit).toBe(0);
    expect(result.balance).toBe(149000);
    expect(result.currency).toBe("EUR");
  });

  it("2. enforces positive/negative rules and rejects invalid amount types", () => {
    const invalidCharge: LedgerEntryRecord = {
      id: "entry-inv",
      studioId: "studio-1",
      clientId: "client-1",
      type: "CHARGE",
      amountMinor: -100,
      currency: "EUR",
      reason: "Invalid negative charge",
      createdById: "user-1",
      createdAt: "2026-06-01T10:00:00.000Z",
    };

    expect(() => calculateLedgerBalance([invalidCharge])).toThrow(RangeError);

    const floatCharge: LedgerEntryRecord = {
      id: "entry-float",
      studioId: "studio-1",
      clientId: "client-1",
      type: "CHARGE",
      amountMinor: 100.5,
      currency: "EUR",
      reason: "Float amount",
      createdById: "user-1",
      createdAt: "2026-06-01T10:00:00.000Z",
    };

    expect(() => calculateLedgerBalance([floatCharge])).toThrow(TypeError);
  });

  it("3. operates with zero floating-point drift over complex transactions", () => {
    // 100 payments of €19.99 (1999 cents) vs charges
    const entries: LedgerEntryRecord[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        id: `entry-pay-${i}`,
        studioId: "studio-1",
        clientId: "client-1",
        type: "PAYMENT",
        amountMinor: 1999,
        currency: "EUR",
        reason: `Installment ${i}`,
        createdById: "user-1",
        createdAt: new Date(1780000000000 + i * 1000).toISOString(),
      });
    }

    const result = calculateLedgerBalance(entries);
    expect(result.totalPayments).toBe(199900);
    expect(result.netPaid).toBe(199900);
    expect(result.credit).toBe(199900);
  });

  it("4. handles refunds, adjustments, outstanding balances, and credit balances", () => {
    const entries: LedgerEntryRecord[] = [
      {
        id: "e-1",
        studioId: "s-1",
        clientId: "c-1",
        type: "CHARGE",
        amountMinor: 10000, // 100 EUR
        currency: "EUR",
        reason: "Service charge",
        createdById: "u-1",
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      {
        id: "e-2",
        studioId: "s-1",
        clientId: "c-1",
        type: "PAYMENT",
        amountMinor: 15000, // 150 EUR (overpayment)
        currency: "EUR",
        reason: "Full prepayment with tip/deposit",
        createdById: "u-1",
        createdAt: "2026-06-01T10:10:00.000Z",
      },
      {
        id: "e-3",
        studioId: "s-1",
        clientId: "c-1",
        type: "REFUND",
        amountMinor: 2000, // 20 EUR refund
        currency: "EUR",
        reason: "Partial refund",
        targetPaymentId: "e-2",
        createdById: "u-1",
        createdAt: "2026-06-01T10:20:00.000Z",
      },
      {
        id: "e-4",
        studioId: "s-1",
        clientId: "c-1",
        type: "ADJUSTMENT",
        amountMinor: -1000, // -10 EUR discount adjustment
        currency: "EUR",
        reason: "Loyalty discount adjustment",
        createdById: "u-1",
        createdAt: "2026-06-01T10:30:00.000Z",
      },
    ];

    const result = calculateLedgerBalance(entries);

    expect(result.totalCharges).toBe(10000);
    expect(result.totalPayments).toBe(15000);
    expect(result.totalRefunds).toBe(2000);
    expect(result.totalAdjustments).toBe(-1000);
    expect(result.netPaid).toBe(13000); // 15000 - 2000
    expect(result.netCharges).toBe(9000); // 10000 - 1000
    expect(result.outstanding).toBe(0);
    expect(result.credit).toBe(4000); // 13000 - 9000 = 4000 EUR credit
    expect(result.balance).toBe(-4000);
  });

  it("5. is deterministic and does not mutate input array", () => {
    const entries: LedgerEntryRecord[] = [
      {
        id: "b",
        studioId: "s",
        clientId: "c",
        type: "PAYMENT",
        amountMinor: 200,
        currency: "EUR",
        reason: "b",
        createdById: "u",
        createdAt: "2026-06-01T12:00:00.000Z",
      },
      {
        id: "a",
        studioId: "s",
        clientId: "c",
        type: "CHARGE",
        amountMinor: 500,
        currency: "EUR",
        reason: "a",
        createdById: "u",
        createdAt: "2026-06-01T10:00:00.000Z",
      },
    ];

    const copy = [...entries];
    const res1 = calculateLedgerBalance(entries);
    const res2 = calculateLedgerBalance(entries);

    expect(res1).toEqual(res2);
    expect(entries).toEqual(copy);
  });
});
