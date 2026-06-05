"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GlobalSearch } from "@/features/search/components/global-search";
import Link from "next/link";

export function AppHeader() {
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
        
        <div className="flex items-center gap-2 sm:gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
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
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="w-5 h-5 text-muted" />
              </Button>
            </div>
          )}
        </div>
      </div>
      
      {session && (
        <GlobalSearch 
          studioId={(session.user as any).studioId || ""} 
          open={searchOpen} 
          onOpenChange={setSearchOpen} 
        />
      )}
    </header>
  );
}
