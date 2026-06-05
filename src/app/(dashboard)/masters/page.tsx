import { getMasters } from "@/features/masters/server/queries";
import { MasterList } from "@/features/masters/components/master-list";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect } from "next/navigation";

export default async function MastersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const mastersList = await getMasters(studioId, { showArchived: true })
    .catch((error) => {
      console.error("[Masters Page Error]", error);
      throw error;
    });

  return <MasterList initialMasters={mastersList} />;
}
