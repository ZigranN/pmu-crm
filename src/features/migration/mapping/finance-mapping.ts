import type {
  LegacyFinanceInput,
  MigrationFinding,
  ClientFinancialReconciliation,
  FinancialReconciliationReport,
} from "../types";
import { calculateLedgerBalance } from "@/features/ledger/domain/balance";
import type { LedgerEntryRecord, LedgerEntryType } from "@/features/ledger/domain/types";

export interface NormalizedFinanceRecord {
  sourceId: string;
  clientId: string;
  appointmentId: string | null;
  cycleId: string | null;
  type: LedgerEntryType;
  amountMinor: number;
  currency: string;
  date: Date;
  method: string | null;
  reference: string | null;
  notes: string | null;
  isOpeningBalanceAdjustment: boolean;
}

export function normalizeLegacyFinance(
  input: LegacyFinanceInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
    appointmentSourceIdToTargetId: Map<string, string>;
    cycleSourceIdToTargetId: Map<string, string>;
    authoritativeCurrency: string;
  }
): {
  normalized: NormalizedFinanceRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  // Client validation
  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "FINANCE_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "finance",
      sourceId: input.id,
      message: `Financial record ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // Currency check
  const currency = (input.currency || "EUR").trim().toUpperCase();
  if (currency !== options.authoritativeCurrency) {
    findings.push({
      code: "FINANCE_CURRENCY_MISMATCH_BLOCKER",
      severity: "BLOCKER",
      entityType: "finance",
      sourceId: input.id,
      message: `Financial record ${input.id} has currency '${currency}' which mismatches authoritative studio currency '${options.authoritativeCurrency}'. No inferred FX rates allowed; blocks cutover.`,
      details: { currency, authoritativeCurrency: options.authoritativeCurrency },
    });
    return { normalized: null, findings };
  }

  // Amount validation (integer minor units / cents)
  if (typeof input.amountMinor !== "number" || !Number.isInteger(input.amountMinor)) {
    findings.push({
      code: "FINANCE_INVALID_AMOUNT_FORMAT",
      severity: "ERROR",
      entityType: "finance",
      sourceId: input.id,
      message: `Financial record ${input.id} amountMinor '${input.amountMinor}' must be an exact integer minor unit (cents)`,
    });
    return { normalized: null, findings };
  }

  const rawType = (input.type || "").trim().toLowerCase();
  let type: LedgerEntryType = "CHARGE";
  let isOpeningBalanceAdjustment = Boolean(input.isOpeningBalanceAdjustment);

  if (rawType === "charge") {
    type = "CHARGE";
    if (input.amountMinor <= 0) {
      findings.push({
        code: "FINANCE_CHARGE_NON_POSITIVE",
        severity: "ERROR",
        entityType: "finance",
        sourceId: input.id,
        message: `Charge amount must be positive, got ${input.amountMinor}`,
      });
      return { normalized: null, findings };
    }
  } else if (rawType === "payment") {
    type = "PAYMENT";
    if (input.amountMinor <= 0) {
      findings.push({
        code: "FINANCE_PAYMENT_NON_POSITIVE",
        severity: "ERROR",
        entityType: "finance",
        sourceId: input.id,
        message: `Payment amount must be positive, got ${input.amountMinor}`,
      });
      return { normalized: null, findings };
    }
  } else if (rawType === "refund") {
    type = "REFUND";
    if (input.amountMinor <= 0) {
      findings.push({
        code: "FINANCE_REFUND_NON_POSITIVE",
        severity: "ERROR",
        entityType: "finance",
        sourceId: input.id,
        message: `Refund amount must be positive, got ${input.amountMinor}`,
      });
      return { normalized: null, findings };
    }
  } else if (rawType === "adjustment" || rawType === "opening_balance") {
    type = "ADJUSTMENT";
    isOpeningBalanceAdjustment = rawType === "opening_balance" || isOpeningBalanceAdjustment;
    if (isOpeningBalanceAdjustment) {
      findings.push({
        code: "FINANCE_OPENING_BALANCE_ADJUSTMENT",
        severity: "INFO",
        entityType: "finance",
        sourceId: input.id,
        message: `Imported explicit opening balance adjustment of ${input.amountMinor / 100} ${currency} for client ${input.clientId} with clear migration audit traceability.`,
      });
    }
  } else {
    findings.push({
      code: "FINANCE_UNKNOWN_TRANSACTION_TYPE",
      severity: "ERROR",
      entityType: "finance",
      sourceId: input.id,
      message: `Unknown finance transaction type '${input.type}'`,
    });
    return { normalized: null, findings };
  }

  let date = new Date();
  if (input.date) {
    const d = new Date(input.date);
    if (!isNaN(d.getTime())) date = d;
  }

  const normalized: NormalizedFinanceRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    appointmentId: input.appointmentId ? (options.appointmentSourceIdToTargetId.get(input.appointmentId) || input.appointmentId) : null,
    cycleId: input.cycleId ? (options.cycleSourceIdToTargetId.get(input.cycleId) || input.cycleId) : null,
    type,
    amountMinor: input.amountMinor,
    currency,
    date,
    method: input.method || null,
    reference: input.reference || null,
    notes: input.notes || (isOpeningBalanceAdjustment ? "MIGRATION_OPENING_BALANCE" : null),
    isOpeningBalanceAdjustment,
  };

  return { normalized, findings };
}

export function computeFinancialReconciliation(
  rawFinances: LegacyFinanceInput[],
  normalizedFinances: NormalizedFinanceRecord[],
  clientsMap: Map<string, { fullName: string }>,
  currency: string = "EUR"
): {
  report: FinancialReconciliationReport;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  // Group raw finances by client to compute legacy expected balance
  const rawByClient = new Map<string, LegacyFinanceInput[]>();
  for (const raw of rawFinances) {
    const list = rawByClient.get(raw.clientId) || [];
    list.push(raw);
    rawByClient.set(raw.clientId, list);
  }

  // Group normalized finances by client to compute imported ledger balance
  const normByClient = new Map<string, NormalizedFinanceRecord[]>();
  for (const norm of normalizedFinances) {
    const list = normByClient.get(norm.clientId) || [];
    list.push(norm);
    normByClient.set(norm.clientId, list);
  }

  const allClientIds = new Set([...rawByClient.keys(), ...normByClient.keys()]);
  const clientSummaries: ClientFinancialReconciliation[] = [];

  let studioLegacyExpectedTotal = 0;
  let studioImportedLedgerTotal = 0;

  for (const clientId of allClientIds) {
    const clientRaw = rawByClient.get(clientId) || [];
    const clientNorm = normByClient.get(clientId) || [];

    // Calculate legacy expected balance
    let legacyCharges = 0;
    let legacyPayments = 0;
    let legacyRefunds = 0;
    let legacyAdjustments = 0;

    for (const item of clientRaw) {
      if (item.currency && item.currency.toUpperCase() !== currency) continue;
      const type = (item.type || "").toLowerCase();
      if (type === "charge") legacyCharges += item.amountMinor;
      else if (type === "payment") legacyPayments += item.amountMinor;
      else if (type === "refund") legacyRefunds += item.amountMinor;
      else if (type === "adjustment" || type === "opening_balance") legacyAdjustments += item.amountMinor;
    }

    const legacyExpectedBalance = (legacyCharges + legacyAdjustments) - (legacyPayments - legacyRefunds);

    // Calculate imported ledger balance using domain calculator
    const dummyEntries: LedgerEntryRecord[] = clientNorm.map((n, idx) => ({
      id: `m-entry-${idx}`,
      studioId: "studio-1",
      clientId: n.clientId,
      type: n.type,
      amountMinor: n.amountMinor,
      currency: n.currency,
      reason: n.notes || "migration_reconciliation",
      createdAt: n.date.toISOString(),
      createdById: "migrator",
    }));

    const summary = calculateLedgerBalance(dummyEntries);
    const importedLedgerBalance = summary.balance;
    const diff = legacyExpectedBalance - importedLedgerBalance;

    studioLegacyExpectedTotal += legacyExpectedBalance;
    studioImportedLedgerTotal += importedLedgerBalance;

    const clientName = clientsMap.get(clientId)?.fullName || `Client ${clientId}`;
    const isBalanced = diff === 0;

    const clientRec: ClientFinancialReconciliation = {
      clientId,
      clientName,
      legacyExpectedBalanceMinor: legacyExpectedBalance,
      importedLedgerBalanceMinor: importedLedgerBalance,
      differenceMinor: diff,
      currency,
      status: isBalanced ? "BALANCED" : "MISMATCHED",
    };

    clientSummaries.push(clientRec);

    if (!isBalanced) {
      findings.push({
        code: "FINANCIAL_RECONCILIATION_MISMATCH_BLOCKER",
        severity: "BLOCKER",
        entityType: "finance",
        sourceId: clientId,
        message: `Financial mismatch for client ${clientName} (${clientId}): legacy expected balance ${legacyExpectedBalance / 100} ${currency} vs imported ledger balance ${importedLedgerBalance / 100} ${currency} (difference: ${diff / 100} ${currency}). Unreconciled balance blocks cutover.`,
        details: { clientId, legacyExpectedBalance, importedLedgerBalance, difference: diff },
      });
    }
  }

  const studioDiff = studioLegacyExpectedTotal - studioImportedLedgerTotal;
  const isStudioReconciled = studioDiff === 0 && clientSummaries.every((c) => c.status === "BALANCED");

  const report: FinancialReconciliationReport = {
    studioTotalLegacyExpectedMinor: studioLegacyExpectedTotal,
    studioTotalImportedLedgerMinor: studioImportedLedgerTotal,
    studioDifferenceMinor: studioDiff,
    currency,
    clientCount: allClientIds.size,
    mismatchedClients: clientSummaries.filter((c) => c.status === "MISMATCHED"),
    isReconciled: isStudioReconciled,
  };

  if (!isStudioReconciled) {
    findings.push({
      code: "STUDIO_FINANCIAL_RECONCILIATION_FAILED",
      severity: "BLOCKER",
      entityType: "finance",
      message: `Studio total financial reconciliation failed with difference ${studioDiff / 100} ${currency}`,
    });
  }

  return { report, findings };
}
