import React from "react";
import { cn } from "@/lib/utils";

interface MobileActionBarProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Плавающая панель действий внизу экрана для мобильных устройств
 */
export function MobileActionBar({ children, className }: MobileActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-[72px] left-0 right-0 z-40 bg-ivory/80 p-4 backdrop-blur-md border-t border-borderSoft md:relative md:bottom-0 md:bg-transparent md:p-0 md:backdrop-blur-none md:border-none",
        className
      )}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3 md:max-w-none">
        {children}
      </div>
    </div>
  );
}
