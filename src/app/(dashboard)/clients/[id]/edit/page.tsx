import { requireBrowserStudioPermission } from "@/server/auth/context";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/features/clients/components/client-form";
import { getClientById } from "@/features/clients/server/queries";
import { redirect, notFound } from "next/navigation";

interface EditClientPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  let context;
  try {
    context = await requireBrowserStudioPermission("CLIENT_UPDATE");
  } catch {
    redirect("/dashboard");
  }
  const { id } = await params;

  const client = await getClientById(id, context.studioId)
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
