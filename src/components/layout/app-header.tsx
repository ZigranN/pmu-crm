"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GlobalSearch } from "@/features/search/components/global-search";
import Link from "next/link";
import { navItems } from "./navigation-items";

export function AppHeader({ studioId }: { studioId?: string }) {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-ivory/80 backdrop-blur-md border-borderSoft">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex flex-col">
            <span className="text-xl font-bold text-taupe leading-none">PMU CRM</span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Alty CRM</span>
          </Link>
        </div>
        
        <nav aria-label="Основная навигация" className="hidden md:flex items-center gap-4 text-sm">
          {navItems.map((item) => <Link key={item.href} href={item.href} className="hover:underline">{item.label}</Link>)}
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
                <span className="text-xs text-muted">{(session.user as any).role}</span>
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
