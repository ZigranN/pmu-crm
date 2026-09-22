import { requireBrowserStudioPermission } from "@/server/auth/context";
import { PageHeader } from "@/components/shared/page-header";
import { ClientForm } from "@/features/clients/components/client-form";

export default async function NewClientPage() {
  await requireBrowserStudioPermission("CLIENT_CREATE");

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
