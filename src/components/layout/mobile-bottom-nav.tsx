"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Home, Scissors, UserCog, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Сегодня", icon: Home, href: "/dashboard" },
  { label: "Клиенты", icon: Users, href: "/clients" },
  { label: "Услуги", icon: Scissors, href: "/services" },
  { label: "Мастера", icon: UserCog, href: "/masters" },
  { label: "Ещё", icon: MoreHorizontal, href: "/settings/studio" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-ivory/95 backdrop-blur-md border-t border-borderSoft md:hidden pb-safe">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full min-h-[44px] space-y-1 transition-colors",
                isActive ? "text-taupe" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("w-5 h-5", isActive && "stroke-[2.5px]")} />
              <span className={cn("text-[10px] font-medium", isActive && "font-bold")}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
