import React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[400px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-borderSoft bg-cream/50 p-8 text-center animate-in fade-in zoom-in duration-300",
        className
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-sand p-4 text-taupe">
          <Icon className="h-8 w-8" />
        </div>
      )}
      <h3 className="mb-2 text-lg font-semibold text-espresso">{title}</h3>
      {description && (
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="bg-taupe hover:bg-espresso text-ivory">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
