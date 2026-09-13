import { AppHeader } from "./app-header";
import { MobileBottomNav } from "./mobile-bottom-nav";

export function DashboardShell({ children, studioId, role }: { children: React.ReactNode; studioId?: string; role?: string | null }) {
  return (
    <div className="flex flex-col min-h-screen bg-cream">
      <AppHeader studioId={studioId} role={role} />
      <main className="flex-1 pb-44 md:pb-8 px-4 sm:px-6 lg:px-8 pt-6 max-w-screen-xl mx-auto w-full">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
