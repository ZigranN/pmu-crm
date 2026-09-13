"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setPreferredMaster } from "@/features/clients/server/administration";
import { assignClientMaster } from "../server/role-management";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function ClientAssignment({ clientId, currentId, masters, kind = "assigned" }: { kind?: "assigned" | "preferred"; clientId: string; currentId: string | null; masters: { id: string; displayName: string }[] }) {
  const request = useRef<{ key: string; payload: string } | null>(null);
  const preferred = kind === "preferred";
  const selectId = `${kind}-master-${clientId}`;
  const [masterId, setMasterId] = useState(currentId ?? ""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const router = useRouter();
  return <form className="rounded border p-4 space-y-3" onSubmit={async e => { e.preventDefault(); setBusy(true); setError("");
    try {
      const data = { clientId, masterId: masterId || null, expectedMasterId: currentId, reason };
      if (preferred) {
        const payload = JSON.stringify(data);
        if (!request.current || request.current.payload !== payload) request.current = { key: crypto.randomUUID(), payload };
        await setPreferredMaster(data, request.current.key);
      } else await assignClientMaster(data); setReason(""); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось назначить мастера"); } finally { setBusy(false); }
  }}>
    {preferred && <p className="text-sm">Пожелание клиента. Не меняет назначенного мастера и доступ к карточке.</p>}
    <label className="block font-medium" htmlFor={selectId}>{preferred ? "Предпочтительный мастер" : "Назначенный мастер"}</label><select id={selectId} className="block border rounded p-2 w-full mt-2" value={masterId} onChange={e => setMasterId(e.target.value)}>
      <option value="">Не назначен</option>{currentId && !masters.some(m => m.id === currentId) && <option value={currentId}>Недоступный мастер</option>}
      {masters.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
    </select>
    <label className="block">{preferred ? "Причина выбора предпочтительного мастера" : "Причина назначения"}<Input required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}<Button disabled={busy} type="submit">{preferred ? "Сохранить предпочтение" : "Сохранить назначение"}</Button>
  </form>;
}
