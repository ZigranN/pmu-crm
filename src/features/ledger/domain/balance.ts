import type { LedgerEntryRecord, FinancialSummary } from "./types";

/**
 * Pure domain balance calculation from an immutable list of ledger entries.
 * Zero database, network or auth dependencies.
 * Integer minor units only (no floating point arithmetic).
 */
export function calculateLedgerBalance(
  entries: readonly LedgerEntryRecord[]
): FinancialSummary {
  // Sort entries deterministically by createdAt then id without mutating input array
  const sorted = [...entries].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  let totalCharges = 0;
  let totalPayments = 0;
  let totalRefunds = 0;
  let totalAdjustments = 0;

  for (const entry of sorted) {
    if (
      typeof entry.amountMinor !== "number" ||
      !Number.isInteger(entry.amountMinor)
    ) {
      throw new TypeError("Ledger entry amountMinor must be an integer");
    }

    switch (entry.type) {
      case "CHARGE":
        if (entry.amountMinor <= 0) {
          throw new RangeError("Charge amountMinor must be positive");
        }
        totalCharges += entry.amountMinor;
        break;

      case "PAYMENT":
        if (entry.amountMinor <= 0) {
          throw new RangeError("Payment amountMinor must be positive");
        }
        totalPayments += entry.amountMinor;
        break;

      case "REFUND":
        if (entry.amountMinor <= 0) {
          throw new RangeError("Refund amountMinor must be positive");
        }
        totalRefunds += entry.amountMinor;
        break;

      case "ADJUSTMENT":
        totalAdjustments += entry.amountMinor;
        break;

      default:
        throw new Error(`Unknown ledger entry type: ${(entry as LedgerEntryRecord).type}`);
    }
  }

  const netPaid = totalPayments - totalRefunds;
  const netCharges = totalCharges + totalAdjustments;
  const balance = netCharges - netPaid;
  const outstanding = Math.max(0, balance);
  const credit = Math.max(0, -balance);

  return {
    totalCharges,
    totalPayments,
    totalRefunds,
    totalAdjustments,
    netPaid,
    netCharges,
    outstanding,
    credit,
    balance,
    currency: sorted[0]?.currency ?? "EUR",
  };
}
