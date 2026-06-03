import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/features/clients/components/client-form";
import { getClientById } from "@/features/clients/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect, notFound } from "next/navigation";

interface EditClientPageProps {
  params: {
    id: string;
  };
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  const client = await getClientById(id, studioId);
  if (!client) notFound();

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
