"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { GlobalSearch } from "@/features/search/components/global-search";

export function AppHeader() {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [studioId, setStudioId] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user?.id) {
      // In a real app we'd fetch the studioId from the session or a separate call
      // For Phase 2 we'll use a hack or assume it's available via session extension if possible
      // But better to use the getCurrentStudioId pattern if we can
      // For now, let's just use the search button to trigger the dialog
    }
  }, [session]);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-ivory/95 backdrop-blur border-borderSoft">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-taupe">PMU CRM</span>
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
