import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/features/clients/components/client-form";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect } from "next/navigation";

export default async function NewClientPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Новый клиент"
        description="Добавьте нового клиента в базу данных"
        backHref="/clients"
      />
      <ClientForm />
    </div>
  );
}
