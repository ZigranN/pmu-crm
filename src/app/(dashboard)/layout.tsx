import {
  readSession,
  getUserActiveStudios,
  readActiveStudioCookieState,
  getActiveStudioMembership,
} from "@/server/auth/context";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SingleStudioBootstrap } from "@/components/layout/single-studio-bootstrap";
import { StudioSelector } from "@/components/layout/studio-selector";
import { AutoClearStaleCookie } from "@/components/layout/auto-clear-stale-cookie";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const activeStudios = await getUserActiveStudios(session.user.id);
  const cookieState = await readActiveStudioCookieState();

  // 1. Authenticated + zero active memberships: render safe no-studio state without domain children
  if (activeStudios.length === 0) {
    return (
      <DashboardShell>
        <div role="status" className="max-w-md mx-auto mt-12 p-6 bg-white rounded-xl border border-borderSoft shadow-xs text-center">
          <h2 className="text-lg font-semibold text-taupe mb-2">Нет активной студии</h2>
          <p className="text-sm text-muted mb-4">
            У вашей учетной записи нет активных членств в студиях. Обратитесь к администратору для получения доступа.
          </p>
          {cookieState.kind !== "missing" && <AutoClearStaleCookie />}
        </div>
      </DashboardShell>
    );
  }

  // 2. Authenticated + missing cookie
  if (cookieState.kind === "missing") {
    if (activeStudios.length === 1) {
      return (
        <DashboardShell activeStudios={activeStudios}>
          <SingleStudioBootstrap studio={activeStudios[0]} />
        </DashboardShell>
      );
    }
    return (
      <DashboardShell activeStudios={activeStudios}>
        <StudioSelector activeStudios={activeStudios} isStale={false} />
      </DashboardShell>
    );
  }

  // 3. Authenticated + invalid cookie
  if (cookieState.kind === "invalid") {
    if (activeStudios.length === 1) {
      return (
        <DashboardShell activeStudios={activeStudios}>
          <SingleStudioBootstrap studio={activeStudios[0]} />
        </DashboardShell>
      );
    }
    return (
      <DashboardShell activeStudios={activeStudios}>
        <StudioSelector activeStudios={activeStudios} isStale={true} />
      </DashboardShell>
    );
  }

  // 4. Valid cookie structure, check if matches active studio membership
  const matchingStudio = activeStudios.find((s) => s.studioId === cookieState.studioId);
  if (!matchingStudio) {
    if (activeStudios.length === 1) {
      return (
        <DashboardShell activeStudios={activeStudios}>
          <SingleStudioBootstrap studio={activeStudios[0]} />
        </DashboardShell>
      );
    }
    return (
      <DashboardShell activeStudios={activeStudios}>
        <StudioSelector activeStudios={activeStudios} isStale={true} />
      </DashboardShell>
    );
  }

  // 5. Valid cookie matching active studio membership
  const context = await getActiveStudioMembership(session.user.id, matchingStudio.studioId);
  if (!context) {
    if (activeStudios.length === 1) {
      return (
        <DashboardShell activeStudios={activeStudios}>
          <SingleStudioBootstrap studio={activeStudios[0]} />
        </DashboardShell>
      );
    }
    return (
      <DashboardShell activeStudios={activeStudios}>
        <StudioSelector activeStudios={activeStudios} isStale={true} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      studioId={context.studioId}
      studioName={context.studioName}
      role={context.role}
      activeStudios={activeStudios}
    >
      {children}
    </DashboardShell>
  );
}
