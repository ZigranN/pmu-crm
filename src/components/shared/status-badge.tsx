import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusVariant = 
  | "success" 
  | "warning" 
  | "danger" 
  | "info" 
  | "muted"
  | "gold";

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-success/10 text-success border-success/20 hover:bg-success/20",
  warning: "bg-warning/10 text-warning border-warning/20 hover:bg-warning/20",
  danger: "bg-danger/10 text-danger border-danger/20 hover:bg-danger/20",
  info: "bg-info/10 text-info border-info/20 hover:bg-info/20",
  muted: "bg-muted/10 text-muted border-muted/20 hover:bg-muted/20",
  gold: "bg-gold/10 text-gold border-gold/20 hover:bg-gold/20",
};

export function StatusBadge({
  label,
  variant = "info",
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-2 py-0.5 font-medium transition-colors",
        variantStyles[variant],
        className
      )}
    >
      {label}
    </Badge>
  );
}
