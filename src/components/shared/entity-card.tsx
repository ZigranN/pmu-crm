import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EntityCardProps {
  title: string;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  image?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function EntityCard({
  title,
  subtitle,
  description,
  image,
  badges,
  actions,
  onClick,
  className,
}: EntityCardProps) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-borderSoft bg-ivory p-4 transition-all hover:shadow-md",
        onClick && "cursor-pointer active:scale-[0.98]",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {image && (
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-sand">
            {image}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="truncate text-base font-semibold text-espresso">
              {title}
            </h4>
            {badges && <div className="flex shrink-0 gap-1">{badges}</div>}
          </div>
          {subtitle && (
            <div className="truncate text-sm text-taupe">{subtitle}</div>
          )}
          {description && (
            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {description}
            </div>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </Card>
  );
}
