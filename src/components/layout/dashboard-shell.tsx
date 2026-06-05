import { AppHeader } from "./app-header";
import { MobileBottomNav } from "./mobile-bottom-nav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-cream">
      <AppHeader />
      <main className="flex-1 pb-24 md:pb-8 px-4 sm:px-6 lg:px-8 pt-6 max-w-screen-md mx-auto w-full">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
