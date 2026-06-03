"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientCard } from "./client-card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { type clients } from "@/db/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ClientListProps {
  initialClients: (typeof clients.$inferSelect)[];
}

export function ClientList({ initialClients }: ClientListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const router = useRouter();

  const filteredClients = initialClients.filter((c) => {
    const matchesSearch = c.fullName.toLowerCase().includes(search.toLowerCase()) || 
                          c.phone.includes(search);
    const matchesStatus = statusFilter === "all" ? true : c.clientStatus === statusFilter;
    return matchesSearch && matchesStatus;
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-11 sm:w-[200px]">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="new_lead">Новый лид</SelectItem>
            <SelectItem value="contacted">Связались</SelectItem>
            <SelectItem value="appointment_booked">Записан</SelectItem>
            <SelectItem value="procedure_done">Процедура выполнена</SelectItem>
            <SelectItem value="returning_client">Постоянный</SelectItem>
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
