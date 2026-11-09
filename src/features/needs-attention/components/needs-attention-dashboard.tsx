"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AttentionReasonCode,
  AttentionSeverity,
  NeedsAttentionItem,
} from "../domain/types";
import { AttentionSummaryCards } from "./attention-summary-cards";
import { AttentionItemCard } from "./attention-item-card";
import { calculateAttentionSummaryCounts, filterAttentionItems } from "../domain/evaluator";
import { CheckCircle2, FilterX } from "lucide-react";

interface NeedsAttentionDashboardProps {
  initialItems: NeedsAttentionItem[];
}

const CATEGORY_REASON_MAP: Record<string, AttentionReasonCode[]> = {
  medical: ["MEDICAL_REVIEW_REQUIRED", "MEDICAL_NOT_CLEARED"],
  consent: ["CONSENT_MISSING", "CONSENT_INVALID"],
  appointments: ["APPOINTMENT_MISSING", "APPOINTMENT_CANCELLED", "APPOINTMENT_PAST_DUE"],
  finance: ["OUTSTANDING_BALANCE"],
  packages: ["TOTAL_FACE_PARTIALLY_COMPLETE", "TOTAL_FACE_BLOCKED"],
  stalled: ["CYCLE_STALLED", "FOLLOW_UP_OVERDUE", "REMOVER_FOLLOW_UP_REQUIRED"],
};

export function NeedsAttentionDashboard({ initialItems }: NeedsAttentionDashboardProps) {
  const [search, setSearch] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<AttentionSeverity | undefined>();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedReason, setSelectedReason] = useState<AttentionReasonCode | undefined>();

  const filteredItems = useMemo(() => {
    let items = initialItems;

    if (search) {
      items = filterAttentionItems(items, { search });
    }
    if (selectedSeverity) {
      items = items.filter((i) => i.severity === selectedSeverity);
    }
    if (selectedCategory && CATEGORY_REASON_MAP[selectedCategory]) {
      const allowed = CATEGORY_REASON_MAP[selectedCategory];
      items = items.filter((i) => allowed.includes(i.reasonCode));
    }
    if (selectedReason) {
      items = items.filter((i) => i.reasonCode === selectedReason);
    }

    return items;
  }, [initialItems, search, selectedSeverity, selectedCategory, selectedReason]);

  const summaryCounts = useMemo(() => {
    return calculateAttentionSummaryCounts(initialItems);
  }, [initialItems]);

  const hasActiveFilters = Boolean(
    search || selectedSeverity || selectedCategory || selectedReason
  );

  const resetFilters = () => {
    setSearch("");
    setSelectedSeverity(undefined);
    setSelectedCategory(undefined);
    setSelectedReason(undefined);
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="Требует внимания"
        description="Операционные проблемы и блокировки, требующие действий персонала"
      />

      {/* Summary Counters */}
      <AttentionSummaryCards
        counts={summaryCounts}
        selectedSeverity={selectedSeverity}
        selectedCategory={selectedCategory}
        onSelectSeverity={(sev) => {
          setSelectedSeverity(sev);
          setSelectedCategory(undefined);
        }}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          setSelectedSeverity(undefined);
        }}
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex-1 max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по клиенту или проблеме..."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedSeverity ?? "ALL"}
            onValueChange={(val) =>
              setSelectedSeverity(val === "ALL" ? undefined : (val as AttentionSeverity))
            }
          >
            <SelectTrigger aria-label="Фильтр по приоритету" className="w-[150px] text-xs h-9">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Все приоритеты</SelectItem>
              <SelectItem value="CRITICAL">Критичный</SelectItem>
              <SelectItem value="HIGH">Высокий</SelectItem>
              <SelectItem value="MEDIUM">Средний</SelectItem>
              <SelectItem value="LOW">Низкий</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs h-9 gap-1 text-muted-foreground"
            >
              <FilterX className="w-3.5 h-3.5" />
              Сбросить
            </Button>
          )}
        </div>
      </div>

      {/* Items List */}
      {filteredItems.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            title="Ничего не найдено"
            description="По выбранным фильтрам нет элементов, требующих внимания."
            actionLabel="Сбросить фильтры"
            onAction={resetFilters}
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Все процессы в порядке"
            description="На текущий момент нет активных блокировок или нерешенных операционных задач."
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground px-1">
            Найдено задач: {filteredItems.length}
          </div>
          {filteredItems.map((item) => (
            <AttentionItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
