import React from "react";
import { EntityCard } from "@/components/shared/entity-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCents } from "@/lib/money";
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
            <span>{service.durationMinutes} мин</span>
          </div>
        </div>
      }
      description={service.description}
      badges={
        <>
          {service.isActive ? (
            <StatusBadge label="Активна" variant="success" />
          ) : (
            <StatusBadge label="В архиве" variant="muted" />
          )}
          <StatusBadge label={formatCents(service.priceCents)} variant="gold" />
        </>
      }
      onClick={onClick}
    />
  );
}
