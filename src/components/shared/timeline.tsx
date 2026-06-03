import React from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface TimelineItemProps {
  title: string;
  description?: string;
  date: Date;
  icon?: React.ReactNode;
  isLast?: boolean;
}

export function TimelineItem({ title, description, date, icon, isLast }: TimelineItemProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
          {icon || <div className="h-2 w-2 rounded-full bg-taupe" />}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" />}
      </div>
      <div className="flex flex-col pb-8">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-espresso">{title}</h4>
          <span className="text-xs text-muted-foreground">
            {format(date, "d MMMM yyyy, HH:mm", { locale: ru })}
          </span>
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

interface TimelineProps {
  children: React.ReactNode;
  className?: string;
}

export function Timeline({ children, className }: TimelineProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}
