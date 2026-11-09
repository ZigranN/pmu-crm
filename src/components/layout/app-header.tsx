"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronDown, LogOut, Search } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { GlobalSearch } from "@/features/search/components/global-search";
import Link from "next/link";
import { getVisibleNavItems } from "./navigation-items";
import { setActiveStudioAction } from "@/features/auth/server/actions";
import type { UserActiveStudio } from "@/server/auth/context";
import { cn } from "@/lib/utils";

export interface AppHeaderProps {
  studioId?: string;
  studioName?: string;
  role?: string | null;
  activeStudios?: UserActiveStudio[];
}

export function AppHeader({ studioId, studioName, role, activeStudios = [] }: AppHeaderProps) {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const visibleItems = getVisibleNavItems(role);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleStudioSwitch = async (newStudioId: string) => {
    if (newStudioId === studioId || isSwitching) return;
    setIsSwitching(true);
    try {
      const res = await setActiveStudioAction(newStudioId);
      if (res.success) {
        router.refresh();
      }
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-ivory/80 backdrop-blur-md border-borderSoft">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex flex-col">
            <span className="text-xl font-bold text-taupe leading-none">PMU CRM</span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Alty CRM</span>
          </Link>

          {studioId && studioName && (
            activeStudios.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSwitching}
                    className="h-8 gap-1.5 px-2.5 text-xs font-medium border-borderSoft bg-white hover:bg-ivory/80 text-taupe"
                  >
                    <Building2 className="w-3.5 h-3.5 text-muted shrink-0" />
                    <span className="max-w-[140px] truncate">{studioName}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted font-normal">
                    Активная студия
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {activeStudios.map((s) => (
                    <DropdownMenuItem
                      key={s.studioId}
                      disabled={isSwitching}
                      onClick={() => handleStudioSwitch(s.studioId)}
                      className="flex items-center justify-between text-xs cursor-pointer"
                    >
                      <span className="truncate">{s.studioName}</span>
                      {s.studioId === studioId && (
                        <Check className="w-4 h-4 text-taupe shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-xs font-medium text-taupe border border-borderSoft">
                <Building2 className="w-3.5 h-3.5 text-muted shrink-0" />
                <span className="max-w-[160px] truncate">{studioName}</span>
              </div>
            )
          )}
        </div>

        <nav aria-label="Основная навигация" className="hidden md:flex items-center gap-1 lg:gap-1.5 xl:gap-2 text-xs lg:text-sm font-medium overflow-x-auto">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "px-2 lg:px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-sand text-taupe font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-taupe hover:bg-sand/40"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Поиск"
            disabled={!studioId}
            onClick={() => setSearchOpen(true)}
            className="text-muted hover:text-taupe"
          >
            <Search className="w-5 h-5" />
          </Button>

          {session && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium">{session.user.name}</span>
                <span className="text-xs text-muted">{role ?? "Нет роли в студии"}</span>
              </div>
              <Button variant="ghost" size="icon" aria-label="Выйти" onClick={handleLogout}>
                <LogOut className="w-5 h-5 text-muted" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {studioId && (
        <GlobalSearch
          studioId={studioId}
          open={searchOpen}
          onOpenChange={setSearchOpen}
        />
      )}
    </header>
  );
}
