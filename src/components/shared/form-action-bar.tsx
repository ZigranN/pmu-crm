"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormActionBarProps {
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function FormActionBar({
  onSave,
  onCancel,
  saveLabel = "Сохранить",
  cancelLabel = "Отмена",
  isSubmitting = false,
  className,
  children,
}: FormActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t bg-ivory/95 backdrop-blur-md p-4 md:relative md:bg-transparent md:border-t-0 md:p-0 md:mt-8",
        "pb-safe", // Support for notched phones
        className
      )}
    >
      <div className="max-w-screen-md mx-auto flex flex-row-reverse gap-3 md:justify-start md:flex-row">
        <Button
          type="button"
          onClick={onSave}
          disabled={isSubmitting}
          className="flex-1 md:flex-initial bg-taupe hover:bg-espresso text-ivory h-12 md:h-10 px-8"
        >
          {isSubmitting ? "Сохранение..." : saveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 md:flex-initial border-taupe text-taupe hover:bg-sand/20 h-12 md:h-10 px-8"
        >
          {cancelLabel}
        </Button>
        {children}
      </div>
      {/* Spacer for mobile bottom nav since this is sticky */}
      <div className="h-16 md:hidden" />
    </div>
  );
}
