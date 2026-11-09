import type {
  AttentionFilterOptions,
  AttentionSeverity,
  AttentionSummaryCounts,
  NeedsAttentionItem,
} from "./types";

const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

/**
 * Deterministically sorts Needs Attention items:
 * 1. Severity: CRITICAL -> HIGH -> MEDIUM -> LOW
 * 2. Overdue status: Past-due items first
 * 3. Age: Older items (createdAt) first
 * 4. Deterministic stable ID fallback
 */
export function sortAttentionItems(
  items: readonly NeedsAttentionItem[],
  referenceTime = new Date()
): NeedsAttentionItem[] {
  const refMs = referenceTime.getTime();

  return [...items].sort((a, b) => {
    // 1. Severity weight
    const weightA = SEVERITY_WEIGHT[a.severity] ?? 99;
    const weightB = SEVERITY_WEIGHT[b.severity] ?? 99;
    if (weightA !== weightB) {
      return weightA - weightB;
    }

    // 2. Overdue status (dueAt in the past)
    const isOverdueA = a.dueAt ? new Date(a.dueAt).getTime() < refMs : false;
    const isOverdueB = b.dueAt ? new Date(b.dueAt).getTime() < refMs : false;
    if (isOverdueA !== isOverdueB) {
      return isOverdueA ? -1 : 1;
    }

    // 3. Due time if both have dueAt
    if (a.dueAt && b.dueAt) {
      const diffDue = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (diffDue !== 0) return diffDue;
    }

    // 4. Age (createdAt ascending -> older items first)
    if (a.createdAt && b.createdAt) {
      const diffCreated =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (diffCreated !== 0) return diffCreated;
    }

    // 5. Stable identity fallback
    return a.id.localeCompare(b.id);
  });
}

/**
 * Deduplicates attention items deterministically by id and removes duplicate financial items.
 */
export function deduplicateAttentionItems(
  items: readonly NeedsAttentionItem[]
): NeedsAttentionItem[] {
  const seenIds = new Set<string>();
  const seenFinancial = new Set<string>();
  const result: NeedsAttentionItem[] = [];

  for (const item of items) {
    if (seenIds.has(item.id)) continue;

    // Deduplicate duplicate financial items for the same client and amount
    if (item.reasonCode === "OUTSTANDING_BALANCE") {
      const financialKey = `${item.clientId}:${item.metadata?.outstandingCents ?? 0}`;
      if (seenFinancial.has(financialKey)) {
        continue;
      }
      seenFinancial.add(financialKey);
    }

    seenIds.add(item.id);
    result.push(item);
  }

  return result;
}

/**
 * Filters items according to provided criteria.
 */
export function filterAttentionItems(
  items: readonly NeedsAttentionItem[],
  filters?: AttentionFilterOptions
): NeedsAttentionItem[] {
  if (!filters) return [...items];

  return items.filter((item) => {
    if (filters.masterId && item.masterId !== filters.masterId) {
      return false;
    }
    if (filters.reason && item.reasonCode !== filters.reason) {
      return false;
    }
    if (filters.severity && item.severity !== filters.severity) {
      return false;
    }
    if (filters.clientId && item.clientId !== filters.clientId) {
      return false;
    }
    if (filters.search) {
      const term = filters.search.toLowerCase().trim();
      const matchName = item.clientName?.toLowerCase().includes(term);
      const matchPhone = item.clientPhone?.toLowerCase().includes(term);
      const matchTitle = item.title.toLowerCase().includes(term);
      const matchDesc = item.description.toLowerCase().includes(term);
      if (!matchName && !matchPhone && !matchTitle && !matchDesc) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Computes exact summary counters matching the filtered items.
 */
export function calculateAttentionSummaryCounts(
  items: readonly NeedsAttentionItem[]
): AttentionSummaryCounts {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let medical = 0;
  let consent = 0;
  let appointments = 0;
  let finance = 0;
  let packages = 0;
  let stalled = 0;

  for (const item of items) {
    switch (item.severity) {
      case "CRITICAL":
        critical++;
        break;
      case "HIGH":
        high++;
        break;
      case "MEDIUM":
        medium++;
        break;
      case "LOW":
        low++;
        break;
    }

    switch (item.reasonCode) {
      case "MEDICAL_REVIEW_REQUIRED":
      case "MEDICAL_NOT_CLEARED":
        medical++;
        break;
      case "CONSENT_MISSING":
      case "CONSENT_INVALID":
        consent++;
        break;
      case "APPOINTMENT_MISSING":
      case "APPOINTMENT_CANCELLED":
      case "APPOINTMENT_PAST_DUE":
        appointments++;
        break;
      case "OUTSTANDING_BALANCE":
        finance++;
        break;
      case "TOTAL_FACE_PARTIALLY_COMPLETE":
      case "TOTAL_FACE_BLOCKED":
        packages++;
        break;
      case "CYCLE_STALLED":
      case "FOLLOW_UP_OVERDUE":
      case "REMOVER_FOLLOW_UP_REQUIRED":
        stalled++;
        break;
    }
  }

  return {
    total: items.length,
    critical,
    high,
    medium,
    low,
    medical,
    consent,
    appointments,
    finance,
    packages,
    stalled,
  };
}
