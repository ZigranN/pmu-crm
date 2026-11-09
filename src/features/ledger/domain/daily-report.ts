import type { LedgerEntryRecord, PaymentMethod } from "./types";

export interface DailyPaymentReportSummary {
  date: string; // YYYY-MM-DD
  cashMinor: number;
  cardMinor: number;
  bankTransferMinor: number;
  otherMinor: number;
  totalReceivedMinor: number;
  totalRefundedMinor: number;
  netReceivedMinor: number;
  unpaidBalancesCount: number;
  unpaidBalancesTotalMinor: number;
  missingPaymentsCount: number;
  missingPaymentsTotalMinor: number;
  pendingAccontoCount: number;
  pendingAccontoTotalMinor: number;
  currency: string;
}

export interface ClientBalanceItem {
  clientId: string;
  outstandingMinor: number;
}

export interface UnpaidProcedureItem {
  appointmentId: string;
  clientId: string;
  missingAmountMinor: number;
}

export interface PendingAccontoItem {
  appointmentId: string;
  clientId: string;
  depositAmountMinor: number;
}

export interface CalculateDailyReportInput {
  date: string; // YYYY-MM-DD
  entries: LedgerEntryRecord[];
  clientBalances?: ClientBalanceItem[];
  missingProcedures?: UnpaidProcedureItem[];
  pendingAccontos?: PendingAccontoItem[];
}

/**
 * Pure calculation of the Daily Payment Report (Requirement 29)
 * Aggregates payments by method (cash, card, bank transfer, other),
 * refunds, net total, and computes outstanding studio totals.
 */
export function calculateDailyPaymentReport(input: CalculateDailyReportInput): DailyPaymentReportSummary {
  const { date, entries, clientBalances = [], missingProcedures = [], pendingAccontos = [] } = input;

  let cashMinor = 0;
  let cardMinor = 0;
  let bankTransferMinor = 0;
  let otherMinor = 0;
  let totalRefundedMinor = 0;

  for (const entry of entries) {
    if (!Number.isInteger(entry.amountMinor)) {
      throw new TypeError(`Ledger entry amountMinor must be an integer, got: ${entry.amountMinor}`);
    }

    const absAmount = Math.abs(entry.amountMinor);

    if (entry.type === "PAYMENT") {
      const method = (entry.paymentMethod || "other").toLowerCase() as PaymentMethod;
      switch (method) {
        case "cash":
          cashMinor += absAmount;
          break;
        case "card":
          cardMinor += absAmount;
          break;
        case "bank_transfer":
          bankTransferMinor += absAmount;
          break;
        default:
          otherMinor += absAmount;
          break;
      }
    } else if (entry.type === "REFUND") {
      totalRefundedMinor += absAmount;
    }
  }

  const totalReceivedMinor = cashMinor + cardMinor + bankTransferMinor + otherMinor;
  const netReceivedMinor = totalReceivedMinor - totalRefundedMinor;

  // Unpaid balances across studio clients
  const activeUnpaidBalances = clientBalances.filter((b) => b.outstandingMinor > 0);
  const unpaidBalancesCount = activeUnpaidBalances.length;
  const unpaidBalancesTotalMinor = activeUnpaidBalances.reduce((acc, b) => acc + b.outstandingMinor, 0);

  // Missing payments for completed procedures
  const missingPaymentsCount = missingProcedures.length;
  const missingPaymentsTotalMinor = missingProcedures.reduce((acc, p) => acc + p.missingAmountMinor, 0);

  // Pending acconto (deposits) for upcoming appointments
  const pendingAccontoCount = pendingAccontos.length;
  const pendingAccontoTotalMinor = pendingAccontos.reduce((acc, a) => acc + a.depositAmountMinor, 0);

  return {
    date,
    cashMinor,
    cardMinor,
    bankTransferMinor,
    otherMinor,
    totalReceivedMinor,
    totalRefundedMinor,
    netReceivedMinor,
    unpaidBalancesCount,
    unpaidBalancesTotalMinor,
    missingPaymentsCount,
    missingPaymentsTotalMinor,
    pendingAccontoCount,
    pendingAccontoTotalMinor,
    currency: "EUR",
  };
}
