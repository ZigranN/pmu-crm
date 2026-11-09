export type LedgerEntryType = "CHARGE" | "PAYMENT" | "REFUND" | "ADJUSTMENT";

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

export interface LedgerEntryRecord {
  id: string;
  studioId: string;
  clientId: string;
  appointmentId?: string | null;
  cycleId?: string | null;
  type: LedgerEntryType;
  amountMinor: number;
  currency: string;
  paymentMethod?: PaymentMethod | null;
  targetPaymentId?: string | null;
  reason: string;
  commandId?: string | null;
  createdById: string;
  createdAt: Date | string;
}

export interface FinancialSummary {
  totalCharges: number;
  totalPayments: number;
  totalRefunds: number;
  totalAdjustments: number;
  netPaid: number;
  netCharges: number;
  outstanding: number;
  credit: number;
  balance: number;
  currency: string;
}
