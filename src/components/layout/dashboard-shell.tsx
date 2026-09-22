import { AppHeader } from "./app-header";
import { MobileBottomNav } from "./mobile-bottom-nav";
import type { UserActiveStudio } from "@/server/auth/context";

export function DashboardShell({
  children,
  studioId,
  studioName,
  role,
  activeStudios,
}: {
  children: React.ReactNode;
  studioId?: string;
  studioName?: string;
  role?: string | null;
  activeStudios?: UserActiveStudio[];
}) {
  return (
    <div className="flex flex-col min-h-screen bg-cream">
      <AppHeader
        studioId={studioId}
        studioName={studioName}
        role={role}
        activeStudios={activeStudios}
      />
      <main className="flex-1 pb-44 md:pb-8 px-4 sm:px-6 lg:px-8 pt-6 max-w-screen-xl mx-auto w-full">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
