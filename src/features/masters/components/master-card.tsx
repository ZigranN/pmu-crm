import React from "react";
import { EntityCard } from "@/components/shared/entity-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { type masters } from "@/db/schema";
import { User, Phone, Mail } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface MasterCardProps {
  master: typeof masters.$inferSelect;
  onClick?: () => void;
}

export function MasterCard({ master, onClick }: MasterCardProps) {
  return (
    <EntityCard
      title={master.displayName}
      image={
        <Avatar className="h-full w-full">
          <AvatarImage src={master.photoUrl || undefined} alt={master.displayName} />
          <AvatarFallback className="bg-sand text-taupe">
            <User className="h-6 w-6" />
          </AvatarFallback>
        </Avatar>
      }
      subtitle={
        <div className="flex flex-col gap-1">
          {master.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              <span>{master.phone}</span>
            </div>
          )}
          {master.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3 w-3" />
              <span>{master.email}</span>
            </div>
          )}
        </div>
      }
      badges={
        <>
          {master.isActive ? (
            <StatusBadge label="Активен" variant="success" />
          ) : (
            <StatusBadge label="В архиве" variant="muted" />
          )}
          {master.calendarColor && (
            <div 
              className="h-4 w-4 rounded-full border border-borderSoft" 
              style={{ backgroundColor: master.calendarColor }}
              title="Цвет в календаре"
            />
          )}
        </>
      }
      onClick={onClick}
    />
  );
}
