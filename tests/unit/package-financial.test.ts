import { describe, it, expect } from "vitest";
import {
  calculatePackageFinancialSummary,
  type CycleFinancialInput,
  type LedgerEntryInput,
} from "@/features/packages/domain/financial";

describe("Package Financial Pure Aggregation", () => {
  it("calculates package totals and per-cycle breakdown without double counting", () => {
    const cycles: CycleFinancialInput[] = [
      {
        cycleId: "cycle-brows",
        zoneCode: "brows",
        expectedPriceCents: 10000,
        appointmentIds: ["appt-1"],
      },
      {
        cycleId: "cycle-eyes",
        zoneCode: "eyes",
        expectedPriceCents: 12000,
        appointmentIds: ["appt-2"],
      },
      {
        cycleId: "cycle-lips",
        zoneCode: "lips",
        expectedPriceCents: 15000,
        appointmentIds: ["appt-3"],
      },
    ];

    const entries: LedgerEntryInput[] = [
      // Brows payment
      { id: "e1", appointmentId: "appt-1", entryType: "PAYMENT", amountMinor: 10000 },
      // Duplicate of e1 (should be ignored)
      { id: "e1", appointmentId: "appt-1", entryType: "PAYMENT", amountMinor: 10000 },
      // Eyes partial payment
      { id: "e2", appointmentId: "appt-2", entryType: "PAYMENT", amountMinor: 6000 },
      // Lips payment and refund
      { id: "e3", appointmentId: "appt-3", entryType: "PAYMENT", amountMinor: 15000 },
      { id: "e4", appointmentId: "appt-3", entryType: "REFUND", amountMinor: 5000 },
    ];

    const summary = calculatePackageFinancialSummary(cycles, entries);

    expect(summary.expectedTotalCents).toBe(37000);
    expect(summary.paidCents).toBe(31000);
    expect(summary.refundsCents).toBe(5000);
    expect(summary.balanceCents).toBe(26000);
    expect(summary.outstandingCents).toBe(11000);

    const brows = summary.cycleBreakdown.find((b) => b.cycleId === "cycle-brows");
    expect(brows?.paidCents).toBe(10000);
    expect(brows?.outstandingCents).toBe(0);

    const eyes = summary.cycleBreakdown.find((b) => b.cycleId === "cycle-eyes");
    expect(eyes?.paidCents).toBe(6000);
    expect(eyes?.outstandingCents).toBe(6000);

    const lips = summary.cycleBreakdown.find((b) => b.cycleId === "cycle-lips");
    expect(lips?.paidCents).toBe(15000);
    expect(lips?.refundsCents).toBe(5000);
    expect(lips?.outstandingCents).toBe(5000);
  });
});
