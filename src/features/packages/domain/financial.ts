import type { PackageFinancialBreakdown, PackageFinancialSummary } from "./types";

export interface CycleFinancialInput {
  cycleId: string;
  zoneCode: string;
  expectedPriceCents: number;
  appointmentIds: string[];
}

export interface LedgerEntryInput {
  id: string;
  appointmentId?: string | null;
  cycleId?: string | null;
  entryType: "PAYMENT" | "REFUND" | "CHARGE" | "ADJUSTMENT" | string;
  amountMinor: number;
}

export function calculatePackageFinancialSummary(
  cycles: CycleFinancialInput[],
  ledgerEntries: LedgerEntryInput[]
): PackageFinancialSummary {
  // Deduplicate ledger entries by ID
  const seenEntryIds = new Set<string>();
  const uniqueEntries: LedgerEntryInput[] = [];

  for (const entry of ledgerEntries) {
    if (!seenEntryIds.has(entry.id)) {
      seenEntryIds.add(entry.id);
      uniqueEntries.push(entry);
    }
  }

  // Map appointmentId to cycleId
  const apptToCycleMap = new Map<string, string>();
  for (const c of cycles) {
    for (const apptId of c.appointmentIds) {
      apptToCycleMap.set(apptId, c.cycleId);
    }
  }

  // Aggregate cycle-specific payments
  const cyclePayments = new Map<string, { paid: number; refunds: number }>();
  for (const c of cycles) {
    cyclePayments.set(c.cycleId, { paid: 0, refunds: 0 });
  }

  let totalPaidCents = 0;
  let totalRefundsCents = 0;

  for (const entry of uniqueEntries) {
    const isPayment = entry.entryType.toUpperCase() === "PAYMENT";
    const isRefund = entry.entryType.toUpperCase() === "REFUND";

    if (isPayment) {
      totalPaidCents += entry.amountMinor;
      const cycleId = entry.cycleId || (entry.appointmentId ? apptToCycleMap.get(entry.appointmentId) : undefined);
      if (cycleId && cyclePayments.has(cycleId)) {
        const current = cyclePayments.get(cycleId)!;
        current.paid += entry.amountMinor;
      }
    } else if (isRefund) {
      totalRefundsCents += entry.amountMinor;
      const cycleId = entry.cycleId || (entry.appointmentId ? apptToCycleMap.get(entry.appointmentId) : undefined);
      if (cycleId && cyclePayments.has(cycleId)) {
        const current = cyclePayments.get(cycleId)!;
        current.refunds += entry.amountMinor;
      }
    }
  }

  let expectedTotalCents = 0;
  const cycleBreakdown: PackageFinancialBreakdown[] = [];

  for (const c of cycles) {
    expectedTotalCents += c.expectedPriceCents;
    const fin = cyclePayments.get(c.cycleId) || { paid: 0, refunds: 0 };
    const outstanding = Math.max(0, c.expectedPriceCents - (fin.paid - fin.refunds));

    cycleBreakdown.push({
      cycleId: c.cycleId,
      zoneCode: c.zoneCode,
      expectedPriceCents: c.expectedPriceCents,
      paidCents: fin.paid,
      refundsCents: fin.refunds,
      outstandingCents: outstanding,
    });
  }

  const netPaidCents = totalPaidCents - totalRefundsCents;
  const outstandingCents = Math.max(0, expectedTotalCents - netPaidCents);
  const balanceCents = netPaidCents;

  return {
    expectedTotalCents,
    paidCents: totalPaidCents,
    refundsCents: totalRefundsCents,
    outstandingCents,
    balanceCents,
    cycleBreakdown,
  };
}
