"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignClientMaster } from "../server/role-management";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function ClientAssignment({ clientId, currentId, masters }: { clientId: string; currentId: string | null; masters: { id: string; displayName: string }[] }) {
  const [masterId, setMasterId] = useState(currentId ?? ""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const router = useRouter();
  return <form className="rounded border p-4 space-y-3" onSubmit={async e => { e.preventDefault(); setBusy(true); setError("");
    try { await assignClientMaster({ clientId, masterId: masterId || null, expectedMasterId: currentId, reason }); setReason(""); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось назначить мастера"); } finally { setBusy(false); }
  }}>
    <label className="block font-medium">Назначенный мастер<select className="block border rounded p-2 w-full mt-2" value={masterId} onChange={e => setMasterId(e.target.value)}>
      <option value="">Не назначен</option>{currentId && !masters.some(m => m.id === currentId) && <option value={currentId}>Недоступный мастер</option>}
      {masters.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
    </select></label>
    <label className="block">Причина назначения<Input required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}<Button disabled={busy} type="submit">Сохранить назначение</Button>
  </form>;
}
