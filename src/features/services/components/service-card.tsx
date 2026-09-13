import React from "react";
import { EntityCard } from "@/components/shared/entity-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { servicePriceLabel } from "../price-label";
import { type services } from "@/db/schema";
import { Clock } from "lucide-react";

interface ServiceCardProps {
  service: typeof services.$inferSelect;
  onClick?: () => void;
}

export function ServiceCard({ service, onClick }: ServiceCardProps) {
  return (
    <EntityCard
      title={service.name}
      subtitle={
        <div className="flex items-center gap-2">
          <span>{service.category}</span>
          <span>•</span>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{service.durationMinutes === null ? "Длительность не задана" : `${service.durationMinutes} мин`}</span>
          </div>
        </div>
      }
      description={service.description}
      badges={
        <>
          {service.catalogVersion === 0 && <StatusBadge label="Требует проверки" variant="muted" />}
          {service.isActive ? (
            <StatusBadge label="Активна" variant="success" />
          ) : (
            <StatusBadge label={service.deletedAt ? "В архиве" : "Неактивна"} variant="muted" />
          )}
          <StatusBadge label={servicePriceLabel(service)} variant="gold" />
        </>
      }
      onClick={onClick}
    />
  );
}
