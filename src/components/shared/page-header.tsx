"use client";
import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  backHref,
  children,
  className,
}: PageHeaderProps) {
  const router = useRouter();

  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          {backHref && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 w-fit gap-1 text-muted-foreground"
              onClick={() => router.push(backHref)}
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Назад</span>
            </Button>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-espresso break-words">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground break-words">{description}</p>
          )}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
      </div>
    </div>
  );
}
