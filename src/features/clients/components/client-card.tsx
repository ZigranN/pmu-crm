import React from "react";
import { EntityCard } from "@/components/shared/entity-card";
import { StatusBadge, type StatusVariant } from "@/components/shared/status-badge";
import { type clients } from "@/db/schema";
import { User, Phone, AtSign } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatPhone } from "@/lib/phone";

interface ClientCardProps {
  client: typeof clients.$inferSelect;
  onClick?: () => void;
}

const statusMap: Record<string, { label: string; variant: StatusVariant }> = {
  new_lead: { label: "Новый лид", variant: "info" },
  contacted: { label: "Связались", variant: "info" },
  needs_consultation: { label: "Нужна консультация", variant: "warning" },
  consultation_booked: { label: "Консультация назначена", variant: "warning" },
  appointment_booked: { label: "Записан", variant: "success" },
  procedure_done: { label: "Процедура выполнена", variant: "success" },
  completed: { label: "Завершено", variant: "muted" },
  lost: { label: "Потерян", variant: "danger" },
  returning_client: { label: "Постоянный", variant: "gold" },
};

export function ClientCard({ client, onClick }: ClientCardProps) {
  const status = statusMap[client.clientStatus] || { label: client.clientStatus, variant: "muted" };

  return (
    <EntityCard
      title={client.fullName}
      image={
        <Avatar className="h-full w-full">
          <AvatarFallback className="bg-cream text-taupe font-bold">
            {client.firstName[0]}{client.lastName?.[0]}
          </AvatarFallback>
        </Avatar>
      }
      subtitle={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Phone className="h-3 w-3" />
            <span>{formatPhone(client.phone)}</span>
          </div>
          {client.instagram && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AtSign className="h-3 w-3" />
              <span>{client.instagram}</span>
            </div>
          )}
        </div>
      }
      badges={
        <>
          <StatusBadge label={status.label} variant={status.variant} />
          {client.tags && (
            <div className="flex gap-1 overflow-hidden">
               {client.tags.split(",").slice(0, 1).map(tag => (
                 <StatusBadge key={tag} label={tag} variant="muted" className="text-[10px]" />
               ))}
            </div>
          )}
        </>
      }
      onClick={onClick}
    />
  );
}
