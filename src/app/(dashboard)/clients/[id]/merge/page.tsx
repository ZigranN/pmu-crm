import { MERGE_FIELDS } from "@/features/clients/merge-contract";
import { getClientById } from "@/features/clients/server/queries";
import { getClientMergeHistory, getMergeCandidates } from "@/features/clients/server/merge-actions";
import { MergeDialog } from "@/features/clients/components/merge-dialog";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";

export default async function ClientMergePage({ params }: { params: Promise<{ id: string }> }) {
  let context;
  try {
    context = await requireBrowserStudioPermission("CLIENT_UPDATE");
  } catch {
    redirect("/dashboard");
  }
  if (context.role !== "OWNER" && context.role !== "ADMIN") notFound();
  const { id } = await params;
  const client = await getClientById(id, context.studioId);
  if (!client) notFound();
  if (client.id !== id) redirect(`/clients/${client.id}/merge`);
  const [rows, history] = await Promise.all([getMergeCandidates(id), getClientMergeHistory(id)]);
  return <div className="space-y-6"><PageHeader title="Объединение клиентов" description={client.fullName} backHref={`/clients/${id}`} />
    <MergeDialog targetId={id} targetName={client.fullName} candidates={rows.map(row => ({ id: row.id, fullName: row.fullName, phone: row.phone, archived: !!row.archivedAt }))} />
    {history.map(row => <details key={row.id} className="rounded border p-3 break-words"><summary>Объединение {row.createdAt.toISOString().slice(0,10)} · {row.reason}</summary>
      <p>Исходная карточка: {row.sourceId}</p><p>Основная карточка на момент операции: {row.targetId}</p>
      <details><summary>Происхождение и исходные значения</summary><dl className="space-y-3">{Object.entries(MERGE_FIELDS).map(([field,label]) => {
        const sourceValues = row.sourceSnapshot as Record<string,unknown>, targetValues = row.targetSnapshot as Record<string,unknown>;
        const show = (value: unknown) => value === null || value === "" ? "Не заполнено" : Array.isArray(value) ? value.join(", ") : String(value);
        return <div key={field}><dt className="font-medium">{label}</dt><dd>Исходная: {show(sourceValues[field])}</dd><dd>Основная: {show(targetValues[field])}</dd><dd>Выбрано из: {row.provenance[field] === row.sourceId ? "исходной" : "основной"}</dd></div>;
      })}</dl></details>
    </details>)}
  </div>;
}
