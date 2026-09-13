import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStudioContext } from "@/server/auth/context";
import { getJobs } from "@/features/jobs/server/queries";
import { RecoveryButton } from "@/features/jobs/components/recovery-button";
const labels: Record<string, string> = { pending: "Ожидает обработки", processing: "Обрабатывается", reconciling: "Проверяется отправка",
  completed: "Выполнено", dead: "Требует внимания", uncertain: "Результат отправки неизвестен" };
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ page?: string; all?: string }> }) {
  const { studioId } = await requireStudioContext(), params = await searchParams;
  const candidate = Number(params.page ?? 1), page = Number.isInteger(candidate) && candidate > 0 && candidate <= 10000 ? candidate : 1;
  const all = params.all === "1";
  const rows = await getJobs(studioId, page, !all).catch(error => { if (error instanceof Error && error.message === "Permission denied") redirect("/dashboard"); throw error; });
  return <div className="space-y-5"><h1 className="text-2xl font-bold">Обработка событий</h1>
    <nav className="flex gap-4"><Link href="/settings/jobs">Требуют внимания</Link><Link href="/settings/jobs?all=1">Все задачи</Link></nav>
    <p className="text-sm text-muted-foreground">Если результат отправки неизвестен, сначала проверяется её статус. Повторная отправка без проверки запрещена.</p>
    {rows.length === 0 && <p>Задач в этом списке нет.</p>}
    {rows.map(job => <article key={job.id} className="rounded border p-3 space-y-2 break-all">
      <h2 className="font-medium">{labels[job.state] ?? job.state}</h2>
      <p className="text-sm">{job.handler} · Попыток: {job.attempts}</p>
      <p className="text-xs">ID: {job.id}</p>
      {job.lastError && <p className="text-sm">Код ошибки: {job.lastError}</p>}
      <details><summary>История попыток</summary><ul>{job.history.map(attempt => <li key={attempt.id} className="text-xs">{attempt.startedAt.toISOString()} · {attempt.outcome} {attempt.errorCode}</li>)}</ul></details>
      {["dead", "uncertain"].includes(job.state) && <RecoveryButton id={job.id} uncertain={job.state === "uncertain"} />}
    </article>)}
    <nav className="flex gap-4">{page > 1 && <Link href={`/settings/jobs?all=${all ? 1 : 0}&page=${page - 1}`}>Назад</Link>}
      <span>Страница {page}</span>{rows.length === 50 && page < 10000 && <Link href={`/settings/jobs?all=${all ? 1 : 0}&page=${page + 1}`}>Далее</Link>}</nav>
  </div>;
}
