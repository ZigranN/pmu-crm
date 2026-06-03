import { AppHeader } from "./app-header";
import { MobileBottomNav } from "./mobile-bottom-nav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-cream">
      <AppHeader />
      <main className="flex-1 pb-20 md:pb-4 px-4 pt-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
