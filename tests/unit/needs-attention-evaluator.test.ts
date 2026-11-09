import { describe, expect, it } from "vitest";
import type { NeedsAttentionItem } from "@/features/needs-attention/domain/types";
import {
  calculateAttentionSummaryCounts,
  deduplicateAttentionItems,
  filterAttentionItems,
  sortAttentionItems,
} from "@/features/needs-attention/domain/evaluator";

describe("Needs Attention Pure Evaluator", () => {
  const baseItem: NeedsAttentionItem = {
    id: "item-1",
    attentionRequired: true,
    severity: "MEDIUM",
    reasonCode: "APPOINTMENT_MISSING",
    title: "Требуется запись",
    description: "Тестовое описание",
    entityType: "TREATMENT_CYCLE",
    entityId: "cycle-1",
    clientId: "client-1",
    suggestedAction: "Записать на прием",
    actionUrl: "/deals/cycle-1",
    createdAt: new Date("2026-10-01T10:00:00Z"),
  };

  describe("sortAttentionItems", () => {
    it("orders by severity: CRITICAL > HIGH > MEDIUM > LOW", () => {
      const low: NeedsAttentionItem = { ...baseItem, id: "low", severity: "LOW" };
      const med: NeedsAttentionItem = { ...baseItem, id: "med", severity: "MEDIUM" };
      const high: NeedsAttentionItem = { ...baseItem, id: "high", severity: "HIGH" };
      const crit: NeedsAttentionItem = { ...baseItem, id: "crit", severity: "CRITICAL" };

      const sorted = sortAttentionItems([low, med, crit, high]);
      expect(sorted.map((i) => i.id)).toEqual(["crit", "high", "med", "low"]);
    });

    it("orders past-due items before non-overdue items within the same severity", () => {
      const now = new Date("2026-10-12T12:00:00Z");
      const overdue: NeedsAttentionItem = {
        ...baseItem,
        id: "overdue",
        severity: "HIGH",
        dueAt: new Date("2026-10-10T12:00:00Z"),
      };
      const future: NeedsAttentionItem = {
        ...baseItem,
        id: "future",
        severity: "HIGH",
        dueAt: new Date("2026-10-15T12:00:00Z"),
      };
      const noDue: NeedsAttentionItem = {
        ...baseItem,
        id: "noDue",
        severity: "HIGH",
        dueAt: null,
      };

      const sorted = sortAttentionItems([future, noDue, overdue], now);
      expect(sorted.map((i) => i.id)).toEqual(["overdue", "future", "noDue"]);
    });

    it("uses stable ID fallback for identical criteria", () => {
      const itemA: NeedsAttentionItem = { ...baseItem, id: "a" };
      const itemB: NeedsAttentionItem = { ...baseItem, id: "b" };

      const sorted = sortAttentionItems([itemB, itemA]);
      expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
    });
  });

  describe("deduplicateAttentionItems", () => {
    it("removes duplicate items with the same id", () => {
      const items = [baseItem, { ...baseItem }, { ...baseItem, id: "item-2" }];
      const deduped = deduplicateAttentionItems(items);
      expect(deduped).toHaveLength(2);
      expect(deduped.map((i) => i.id)).toEqual(["item-1", "item-2"]);
    });

    it("deduplicates identical financial facts for the same client", () => {
      const fin1: NeedsAttentionItem = {
        ...baseItem,
        id: "fin-cycle",
        reasonCode: "OUTSTANDING_BALANCE",
        clientId: "client-fin",
        metadata: { outstandingCents: 5000 },
      };
      const fin2: NeedsAttentionItem = {
        ...baseItem,
        id: "fin-appt",
        reasonCode: "OUTSTANDING_BALANCE",
        clientId: "client-fin",
        metadata: { outstandingCents: 5000 },
      };

      const deduped = deduplicateAttentionItems([fin1, fin2]);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].id).toBe("fin-cycle");
    });
  });

  describe("calculateAttentionSummaryCounts", () => {
    it("calculates exact summary counts matching items", () => {
      const items: NeedsAttentionItem[] = [
        { ...baseItem, id: "1", severity: "CRITICAL", reasonCode: "MEDICAL_NOT_CLEARED" },
        { ...baseItem, id: "2", severity: "HIGH", reasonCode: "MEDICAL_REVIEW_REQUIRED" },
        { ...baseItem, id: "3", severity: "HIGH", reasonCode: "CONSENT_MISSING" },
        { ...baseItem, id: "4", severity: "HIGH", reasonCode: "CONSENT_INVALID" },
        { ...baseItem, id: "5", severity: "HIGH", reasonCode: "APPOINTMENT_PAST_DUE" },
        { ...baseItem, id: "6", severity: "HIGH", reasonCode: "APPOINTMENT_CANCELLED" },
        { ...baseItem, id: "7", severity: "MEDIUM", reasonCode: "APPOINTMENT_MISSING" },
        { ...baseItem, id: "8", severity: "MEDIUM", reasonCode: "OUTSTANDING_BALANCE" },
        { ...baseItem, id: "9", severity: "HIGH", reasonCode: "TOTAL_FACE_BLOCKED" },
        { ...baseItem, id: "10", severity: "MEDIUM", reasonCode: "TOTAL_FACE_PARTIALLY_COMPLETE" },
        { ...baseItem, id: "11", severity: "LOW", reasonCode: "CYCLE_STALLED" },
        { ...baseItem, id: "12", severity: "HIGH", reasonCode: "FOLLOW_UP_OVERDUE" },
        { ...baseItem, id: "13", severity: "MEDIUM", reasonCode: "REMOVER_FOLLOW_UP_REQUIRED" },
      ];

      const counts = calculateAttentionSummaryCounts(items);
      expect(counts.total).toBe(13);
      expect(counts.critical).toBe(1);
      expect(counts.high).toBe(7);
      expect(counts.medium).toBe(4);
      expect(counts.low).toBe(1);
      expect(counts.medical).toBe(2);
      expect(counts.consent).toBe(2);
      expect(counts.appointments).toBe(3);
      expect(counts.finance).toBe(1);
      expect(counts.packages).toBe(2);
      expect(counts.stalled).toBe(3);
    });
  });

  describe("filterAttentionItems", () => {
    const item1: NeedsAttentionItem = {
      ...baseItem,
      id: "1",
      masterId: "m1",
      severity: "CRITICAL",
      reasonCode: "MEDICAL_NOT_CLEARED",
      clientName: "Анна Смирнова",
    };
    const item2: NeedsAttentionItem = {
      ...baseItem,
      id: "2",
      masterId: "m2",
      severity: "HIGH",
      reasonCode: "CONSENT_MISSING",
      clientName: "Мария Иванова",
    };

    it("filters by masterId", () => {
      const res = filterAttentionItems([item1, item2], { masterId: "m1" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("1");
    });

    it("filters by severity", () => {
      const res = filterAttentionItems([item1, item2], { severity: "HIGH" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("2");
    });

    it("filters by reason", () => {
      const res = filterAttentionItems([item1, item2], { reason: "CONSENT_MISSING" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("2");
    });

    it("filters by search term", () => {
      const res = filterAttentionItems([item1, item2], { search: "Анна" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("1");
    });
  });
});
