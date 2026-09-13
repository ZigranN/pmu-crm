import { requireStudioPermission } from "@/server/auth/context";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/features/clients/components/client-form";
import { getClientById } from "@/features/clients/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect, notFound } from "next/navigation";

interface EditClientPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  await requireStudioPermission("CLIENT_UPDATE");
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const client = await getClientById(id, studioId)
    .catch((error) => {
      console.error("[Client Edit Page Error]", error);
      throw error;
    });
  
  if (!client) notFound();
  if (client.id !== id) redirect(`/clients/${client.id}/edit`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Редактирование клиента"
        description={`${client.firstName} ${client.lastName || ""}`}
        backHref={`/clients/${id}`}
      />
      <ClientForm initialData={client} />
    </div>
  );
}
