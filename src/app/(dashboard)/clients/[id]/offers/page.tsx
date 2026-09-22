import { requireBrowserStudioPermission } from "@/server/auth/context";
import { getClientById } from "@/features/clients/server/queries";
import { getOfferWorkspace } from "@/features/offers/server/queries";
import { OfferForm } from "@/features/offers/components/offer-form";
import { PageHeader } from "@/components/shared/page-header";
import { notFound, redirect } from "next/navigation";

export default async function OffersPage({ params }: { params: Promise<{ id: string }> }) {
  let context;
  try {
    context = await requireBrowserStudioPermission("OFFER_READ");
  } catch {
    redirect("/dashboard");
  }
  const { id } = await params;
  const client = await getClientById(id, context.studioId);
  if (!client) notFound();
  if (client.id !== id) redirect(`/clients/${client.id}/offers`);
  const workspace = await getOfferWorkspace(id);
  return (
    <div className="space-y-6">
      <PageHeader title="Custom Offer" description={client.fullName} backHref={`/clients/${id}`} />
      <OfferForm clientId={id} workspace={workspace} />
    </div>
  );
}
