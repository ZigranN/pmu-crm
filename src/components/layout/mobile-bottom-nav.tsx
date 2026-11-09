"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileNavItems } from "./navigation-items";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Нижняя навигация" className="fixed bottom-0 left-0 right-0 z-50 bg-ivory/95 backdrop-blur-md border-t border-borderSoft md:hidden pb-safe">
      <div className="flex items-center justify-around h-16 px-1">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const isMore = item.href === "/settings";
          const isActive = isMore
            ? pathname.startsWith("/settings") ||
              pathname.startsWith("/services") ||
              pathname.startsWith("/masters") ||
              pathname.startsWith("/handoffs") ||
              pathname.startsWith("/automations") ||
              pathname.startsWith("/operations") ||
              pathname.startsWith("/deals")
            : pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full min-h-[44px] min-w-[44px] py-1 transition-colors",
                isActive ? "text-taupe" : "text-muted-foreground hover:text-taupe"
              )}
            >
              <Icon className={cn("w-5 h-5", isActive ? "stroke-[2.5px] text-taupe" : "text-muted-foreground")} />
              <span className={cn("text-[10px] tracking-tight leading-tight", isActive ? "font-bold text-taupe" : "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
