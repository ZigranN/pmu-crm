"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientCard, type ClientWithCycles } from "./client-card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CYCLE_STAGES, STAGE_LABELS, type CycleStage } from "@/features/treatment-cycles/stages";

interface ClientListProps {
  initialClients: ClientWithCycles[];
}

export function ClientList({ initialClients }: ClientListProps) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const router = useRouter();

  const filteredClients = initialClients.filter((c) => {
    const matchesSearch = c.fullName.toLowerCase().includes(search.toLowerCase()) || 
                          c.phone.includes(search);
    const matchesStage = stageFilter === "all"
      ? true
      : (c.cycles ?? []).some((cycle) => cycle.stage === stageFilter);
    return matchesSearch && matchesStage;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Клиенты" description="База данных клиентов студии">
        <Button
          onClick={() => router.push("/clients/new")}
          className="bg-taupe hover:bg-espresso text-ivory h-11"
        >
          <Plus className="mr-2 h-4 w-4" />
          Добавить
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Поиск по имени или телефону..."
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="h-11 sm:w-[240px]">
            <SelectValue placeholder="Все стадии" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все стадии</SelectItem>
            {CYCLE_STAGES.map((stage: CycleStage) => (
              <SelectItem key={stage} value={stage}>
                {STAGE_LABELS[stage] ?? stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredClients.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onClick={() => router.push(`/clients/${client.id}`)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title={search ? "Ничего не найдено" : "Клиентов пока нет"}
          description={
            search
              ? "Попробуйте изменить параметры поиска"
              : "Начните наполнять базу данных, добавив первого клиента"
          }
          actionLabel={!search ? "Добавить клиента" : undefined}
          onAction={() => router.push("/clients/new")}
        />
      )}
    </div>
  );
}
