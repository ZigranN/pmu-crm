import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStudioContext } from "@/server/auth/context";
import { getJournal } from "@/features/audit/server/queries";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const { studioId } = await requireStudioContext();
  const params = await searchParams;
  const kind = params.kind === "access" ? "access" : "audit";
  const requestedPage = Number(params.page ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10000 ? requestedPage : 1;
  const rows = await getJournal(studioId, kind, page).catch(error => {
    if (error instanceof Error && error.message === "Permission denied") redirect("/dashboard");
    throw error;
  });
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">История изменений и доступа</h1>
    <nav className="flex gap-4"><Link href="/settings/audit">Изменения</Link><Link href="/settings/audit?kind=access">Доступ к данным</Link></nav>
    <p className="text-sm text-muted-foreground">Доступно владельцу студии. Чтение журнала также фиксируется.</p>
    {rows.length === 0 && <p>Записей пока нет.</p>}
    <div className="space-y-3">{rows.map(row => <details key={row.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer break-all">{row.createdAt.toISOString()} · {"action" in row ? row.action : row.operation}</summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(row, null, 2)}</pre>
    </details>)}</div>
    <nav className="flex gap-4 items-center">
      {page > 1 && <Link href={`/settings/audit?kind=${kind}&page=${page - 1}`}>Назад</Link>}
      <span>Страница {page}</span>
      {rows.length === 50 && page < 10000 && <Link href={`/settings/audit?kind=${kind}&page=${page + 1}`}>Далее</Link>}
    </nav>
  </div>;
}
