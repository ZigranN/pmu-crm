import { getClients } from "@/features/clients/server/queries";
import { ClientList } from "@/features/clients/components/client-list";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

export default async function ClientsPage() {
  let context;
  try {
    context = await requireBrowserStudioPermission("CLIENT_READ");
  } catch {
    redirect("/dashboard");
  }

  const clientsList = await getClients(context.studioId)
    .catch((error) => {
      console.error("[Clients Page Error]", error);
      throw error;
    });

  return <ClientList initialClients={clientsList} />;
}
