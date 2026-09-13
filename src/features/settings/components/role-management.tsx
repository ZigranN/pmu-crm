"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveMembership } from "../server/role-management";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Member = { email: string; name: string; role: string; active: boolean; masterId: string | null };
export function RoleManagement({ members, masters }: { members: Member[]; masters: { id: string; displayName: string }[] }) {
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"OWNER" | "ADMIN" | "MASTER">("MASTER");
  const [active, setActive] = useState(true); const [masterId, setMasterId] = useState("");
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <div className="space-y-6">
    <ul className="space-y-3">{members.map(m => <li key={m.email} className="rounded border p-3 flex flex-wrap justify-between gap-3">
      <div><strong>{m.name}</strong><p className="break-all text-sm">{m.email} · {m.role} · {m.active ? "Активен" : "Отключён"}</p></div>
      <Button variant="outline" onClick={() => { setEmail(m.email); setRole(m.role === "OWNER" || m.role === "ADMIN" ? m.role : "MASTER"); setActive(m.active); setMasterId(m.masterId ?? ""); setReason(""); }}>Изменить</Button>
    </li>)}</ul>
    <form className="space-y-4 max-w-xl" onSubmit={async e => { e.preventDefault(); setBusy(true); setError("");
      try { await saveMembership({ email, role, active, masterId: masterId || null, reason }); setReason(""); router.refresh(); }
      catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить"); } finally { setBusy(false); }
    }}>
      <h2 className="font-semibold">Добавить или изменить участника</h2>
      <label className="block">Email зарегистрированного пользователя<Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block">Роль<select className="block border rounded p-2 w-full" value={role} onChange={e => { setRole(e.target.value as typeof role); if (e.target.value === "ADMIN") setMasterId(""); }}>
        <option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="MASTER">Master</option>
      </select></label>
      <label className="block">Профиль мастера<select className="block border rounded p-2 w-full" value={masterId} disabled={!active || role === "ADMIN"} onChange={e => setMasterId(e.target.value)}>
        <option value="">Без привязки</option>{masters.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
      </select></label>
      <label className="flex gap-2"><input type="checkbox" checked={active} onChange={e => { setActive(e.target.checked); if (!e.target.checked) setMasterId(""); }} />Активен</label>
      <label className="block">Причина изменения<Input required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p className="text-sm text-muted-foreground">Без привязки к профилю Master не увидит клиентов. Последнего Owner отключить нельзя.</p>
      {error && <p role="alert">{error}</p>}<Button disabled={busy} type="submit">{busy ? "Сохранение…" : "Сохранить участника"}</Button>
    </form>
  </div>;
}
