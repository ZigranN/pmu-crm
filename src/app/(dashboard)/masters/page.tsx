import { getMasters } from "@/features/masters/server/queries";
import { MasterList } from "@/features/masters/components/master-list";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

export default async function MastersPage() {
  let context;
  try {
    context = await requireBrowserStudioPermission("MASTER_READ");
  } catch {
    redirect("/dashboard");
  }

  const mastersList = await getMasters(context.studioId, { showArchived: true })
    .catch((error) => {
      console.error("[Masters Page Error]", error);
      throw error;
    });

  return <MasterList initialMasters={mastersList} />;
}
