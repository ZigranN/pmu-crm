"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ServiceCard } from "../components/service-card";
import { Button } from "@/components/ui/button";
import { Plus, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { type services } from "@/db/schema";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ServiceListProps {
  initialServices: (typeof services.$inferSelect)[];
}

export function ServiceList({ initialServices }: ServiceListProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const router = useRouter();

  const filteredServices = initialServices.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchesTab = tab === "active" ? s.isActive : !s.isActive;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Услуги" description="Управление списком услуг студии">
        <Button
          onClick={() => router.push("/services/new")}
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
          placeholder="Поиск по названию..."
        />
        
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-sand/50">
            <TabsTrigger value="active">Активные</TabsTrigger>
            <TabsTrigger value="archived">Архив</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filteredServices.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredServices.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onClick={() => router.push(`/services/${service.id}/edit`)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Scissors}
          title={search ? "Ничего не найдено" : "Услуг пока нет"}
          description={
            search
              ? "Попробуйте изменить параметры поиска"
              : "Создайте свою первую услугу, чтобы начать работу"
          }
          actionLabel={!search ? "Добавить услугу" : undefined}
          onAction={() => router.push("/services/new")}
        />
      )}
    </div>
  );
}
