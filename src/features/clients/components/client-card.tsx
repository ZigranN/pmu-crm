import React from "react";
import { EntityCard } from "@/components/shared/entity-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { type clients } from "@/db/schema";
import { Phone, AtSign } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatPhone } from "@/lib/phone";
import { ZONE_LABELS, STAGE_LABELS, type CycleStage } from "@/features/treatment-cycles/stages";

export interface ClientCycleSummary {
  id: string;
  zoneCode: string;
  kind: string;
  stage: string;
  updatedAt?: Date;
}

export type ClientWithCycles = Omit<typeof clients.$inferSelect, "ltvCents"> & {
  ltvCents: number | null;
  cycles?: ClientCycleSummary[];
};

interface ClientCardProps {
  client: ClientWithCycles;
  onClick?: () => void;
}

export function ClientCard({ client, onClick }: ClientCardProps) {
  const activeCycles = client.cycles ?? [];

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
          {activeCycles.length === 0 && (
            <StatusBadge label="Нет активных циклов" variant="muted" />
          )}
          {activeCycles.length === 1 && (
            <StatusBadge
              label={`${ZONE_LABELS[activeCycles[0].zoneCode] ?? activeCycles[0].zoneCode}: ${STAGE_LABELS[activeCycles[0].stage as CycleStage] ?? activeCycles[0].stage}`}
              variant="info"
            />
          )}
          {activeCycles.length > 1 && (
            <>
              {activeCycles.slice(0, 2).map((c) => (
                <StatusBadge
                  key={c.id}
                  label={`${ZONE_LABELS[c.zoneCode] ?? c.zoneCode}: ${STAGE_LABELS[c.stage as CycleStage] ?? c.stage}`}
                  variant="info"
                  className="text-[10px]"
                />
              ))}
              {activeCycles.length > 2 && (
                <StatusBadge
                  label={`+${activeCycles.length - 2}`}
                  variant="muted"
                  className="text-[10px]"
                />
              )}
            </>
          )}
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
