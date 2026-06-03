"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Users, Home, Settings, PlusCircle, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Сегодня", icon: Home, href: "/dashboard" },
  { label: "Календарь", icon: Calendar, href: "/calendar" },
  { label: "Добавить", icon: PlusCircle, href: "/clients/new" },
  { label: "Клиенты", icon: Users, href: "/clients" },
  { label: "Ещё", icon: MoreHorizontal, href: "/settings" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-ivory border-t border-borderSoft md:hidden">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors",
                isActive ? "text-taupe" : "text-muted"
              )}
            >
              <Icon className={cn("w-6 h-6")} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
