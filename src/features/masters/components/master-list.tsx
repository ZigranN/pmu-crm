"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { MasterCard } from "./master-card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { type masters } from "@/db/schema";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MasterListProps {
  initialMasters: (typeof masters.$inferSelect)[];
}

export function MasterList({ initialMasters }: MasterListProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const router = useRouter();

  const filteredMasters = initialMasters.filter((m) => {
    const matchesSearch = m.displayName.toLowerCase().includes(search.toLowerCase());
    const matchesTab = tab === "active" ? m.isActive : !m.isActive;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Мастера" description="Сотрудники и мастера вашей студии">
        <Button
          onClick={() => router.push("/masters/new")}
          className="bg-taupe hover:bg-espresso text-ivory h-11"
        >
          <Plus className="mr-2 h-4 w-4" />
          Добавить
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Поиск по имени..."
        />
        
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-sand/50">
            <TabsTrigger value="active">Активные</TabsTrigger>
            <TabsTrigger value="archived">Архив</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filteredMasters.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMasters.map((master) => (
            <MasterCard
              key={master.id}
              master={master}
              onClick={() => router.push(`/masters/${master.id}/edit`)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title={search ? "Ничего не найдено" : "Мастеров пока нет"}
          description={
            search
              ? "Попробуйте изменить параметры поиска"
              : "Добавьте первого мастера, чтобы начать планировать записи"
          }
          actionLabel={!search ? "Добавить мастера" : undefined}
          onAction={() => router.push("/masters/new")}
        />
      )}
    </div>
  );
}
