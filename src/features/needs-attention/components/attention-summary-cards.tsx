"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { AttentionSeverity, AttentionSummaryCounts } from "../domain/types";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CreditCard,
  FileCheck,
  HeartPulse,
  Layers,
  Clock,
} from "lucide-react";

interface AttentionSummaryCardsProps {
  counts: AttentionSummaryCounts;
  selectedSeverity?: AttentionSeverity;
  selectedCategory?: string;
  onSelectSeverity?: (severity?: AttentionSeverity) => void;
  onSelectCategory?: (category?: string) => void;
}

export function AttentionSummaryCards({
  counts,
  selectedSeverity,
  selectedCategory,
  onSelectSeverity,
  onSelectCategory,
}: AttentionSummaryCardsProps) {
  const cards = [
    {
      id: "critical",
      label: "Критичные",
      count: counts.critical,
      icon: AlertCircle,
      color: "text-destructive",
      bg: "bg-destructive/10 border-destructive/30",
      active: selectedSeverity === "CRITICAL",
      onClick: () =>
        onSelectSeverity?.(selectedSeverity === "CRITICAL" ? undefined : "CRITICAL"),
    },
    {
      id: "high",
      label: "Высокий приоритет",
      count: counts.high,
      icon: AlertTriangle,
      color: "text-amber-600",
      bg: "bg-amber-500/10 border-amber-500/30",
      active: selectedSeverity === "HIGH",
      onClick: () =>
        onSelectSeverity?.(selectedSeverity === "HIGH" ? undefined : "HIGH"),
    },
    {
      id: "medical",
      label: "Медицина",
      count: counts.medical,
      icon: HeartPulse,
      color: "text-rose-600",
      bg: "bg-rose-500/10 border-rose-500/30",
      active: selectedCategory === "medical",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "medical" ? undefined : "medical"),
    },
    {
      id: "consent",
      label: "Согласия",
      count: counts.consent,
      icon: FileCheck,
      color: "text-purple-600",
      bg: "bg-purple-500/10 border-purple-500/30",
      active: selectedCategory === "consent",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "consent" ? undefined : "consent"),
    },
    {
      id: "appointments",
      label: "Записи",
      count: counts.appointments,
      icon: Calendar,
      color: "text-blue-600",
      bg: "bg-blue-500/10 border-blue-500/30",
      active: selectedCategory === "appointments",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "appointments" ? undefined : "appointments"),
    },
    {
      id: "finance",
      label: "Финансы",
      count: counts.finance,
      icon: CreditCard,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10 border-emerald-500/30",
      active: selectedCategory === "finance",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "finance" ? undefined : "finance"),
    },
    {
      id: "packages",
      label: "Пакеты",
      count: counts.packages,
      icon: Layers,
      color: "text-indigo-600",
      bg: "bg-indigo-500/10 border-indigo-500/30",
      active: selectedCategory === "packages",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "packages" ? undefined : "packages"),
    },
    {
      id: "stalled",
      label: "Контроль",
      count: counts.stalled,
      icon: Clock,
      color: "text-taupe",
      bg: "bg-taupe/10 border-taupe/30",
      active: selectedCategory === "stalled",
      onClick: () =>
        onSelectCategory?.(selectedCategory === "stalled" ? undefined : "stalled"),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            onClick={c.onClick}
            type="button"
            className="text-left focus:outline-none"
          >
            <Card
              className={`p-3 transition-all cursor-pointer border ${
                c.active ? `${c.bg} ring-2 ring-primary/40` : "bg-card hover:bg-accent/40"
              }`}
            >
              <CardContent className="p-0 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-muted-foreground truncate">
                    {c.label}
                  </span>
                  <Icon className={`w-3.5 h-3.5 ${c.color}`} />
                </div>
                <div className="text-xl font-bold">{c.count}</div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
