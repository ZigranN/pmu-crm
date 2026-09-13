import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const studioId = await getCurrentStudioId(session.user.id);
  return <DashboardShell studioId={studioId}>
    {!studioId && <p role="status" className="mb-4 rounded-lg border p-4 text-sm">У аккаунта нет активной студии. Обратитесь к администратору.</p>}
    {children}
  </DashboardShell>;
}
