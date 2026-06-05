import { getClients } from "@/features/clients/server/queries";
import { ClientList } from "@/features/clients/components/client-list";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect } from "next/navigation";

export default async function ClientsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const clientsList = await getClients(studioId)
    .catch((error) => {
      console.error("[Clients Page Error]", error);
      throw error;
    });

  return <ClientList initialClients={clientsList} />;
}
