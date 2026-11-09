import { redirect } from "next/navigation";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { getOperationsDashboardData } from "@/features/operations/server/queries";
import { OperationsDashboard } from "@/features/operations/components/operations-dashboard";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const { studioId } = await requireBrowserStudioContext();

  const data = await getOperationsDashboardData(studioId).catch((error) => {
    if (
      error instanceof Error &&
      (error.message === "Permission denied" ||
        error.message.includes("Permission denied") ||
        error.message.includes("UNAUTHORIZED"))
    ) {
      redirect("/dashboard");
    }
    throw error;
  });

  return <OperationsDashboard data={data} />;
}
