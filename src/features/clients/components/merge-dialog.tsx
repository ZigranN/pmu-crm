"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewClientMerge, mergeClientsAction } from "../server/merge-actions";
import type { MergePreview } from "../server/merge";
import { MERGE_RELATION_LABELS, MERGE_FIELDS, type MergeInput, type MergeField } from "../merge-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const display = (value: unknown) => value === null || value === "" ? "Не заполнено" : typeof value === "boolean" ? value ? "Да" : "Нет" : Array.isArray(value) ? value.join(", ") || "Нет" : String(value);
export function MergeDialog({ targetId, targetName, candidates }: { targetId: string; targetName: string; candidates: { id: string; fullName: string; phone: string; archived: boolean }[] }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(""); const [preview, setPreview] = useState<MergePreview | null>(null);
  const [choices, setChoices] = useState<MergeInput["choices"]>({}); const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const request = useRef<{ payload: string; key: string } | null>(null); const running = useRef(false);
  async function inspect() {
    if (running.current) return; running.current = true; setBusy(true);
    try { const result = await previewClientMerge({ sourceId, targetId }); setPreview(result); setChoices({}); setConfirmed(false); request.current = null; }
    catch { toast.error("Проверка недоступна. Проверьте выбранную карточку и права доступа."); }
    finally { running.current = false; setBusy(false); }
  }
  async function merge() {
    if (!preview || !confirmed || running.current) return; running.current = true; setBusy(true);
    try {
      const input: MergeInput = { sourceId: preview.sourceId, targetId, token: preview.token, choices, reason };
      const payload = JSON.stringify(input);
      if (!request.current || request.current.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
      const result = await mergeClientsAction(input, request.current.key);
      if (result.kind === "stale") { setPreview(null); setConfirmed(false); toast.error("Данные изменились. Повторите проверку и выбор значений."); return; }
      toast.success("Карточки объединены. История сохранена."); router.push(`/clients/${result.id}`); router.refresh();
    } catch { toast.error("Объединение не подтверждено. Повторите с теми же данными или обновите проверку."); }
    finally { running.current = false; setBusy(false); }
  }
  const missing = preview?.fields.some(row => row.conflict && !choices[row.field]);
  return <section aria-label="Объединение клиентов" className="space-y-4 min-w-0">
    <p>Основная карточка: <strong>{targetName}</strong>. Выбранная ниже карточка станет ссылкой на основную. Старые ID, исходные данные и история сохранятся.</p>
    <label className="block" htmlFor="merge-source">Карточка-дубль</label>
    <select id="merge-source" className="w-full min-w-0 rounded border p-2" disabled={busy} value={sourceId} onChange={event => { setSourceId(event.target.value); setPreview(null); }}>
      <option value="">Выберите карточку</option>{candidates.map(row => <option key={row.id} value={row.id}>{row.fullName} · {row.phone}{row.archived ? " · Архив" : ""}</option>)}
    </select>
    <Button type="button" disabled={!sourceId || busy} onClick={inspect}>Проверить объединение</Button>
    {preview && <div className="space-y-4">
      <p>{preview.sourceName} → {preview.targetName}</p>
      <p>Связанные записи будут перенесены без изменения сумм, документов, фотографий и снимков визитов. Сохранённые счётчики визитов и LTV складываются; это не перерасчёт финансового ledger.</p>
      <details><summary>Количество переносимых записей</summary><ul>{Object.entries(preview.counts).map(([name,count]) => <li key={name} className="break-all">{MERGE_RELATION_LABELS[name] ?? name}: {count}</li>)}</ul></details>
      {preview.medicalConflict && <p role="alert" className="rounded border p-3">Есть два медицинских профиля. Оба сохранятся; профиль основной карточки останется текущим с отметкой о необходимости проверки специалистом.</p>}
      {preview.fields.filter(row => row.conflict).map(row => <fieldset key={row.field} className="min-w-0 rounded border p-3 space-y-2"><legend>{row.label}</legend>
        {(["target", "source"] as const).map(side => <label key={side} className="flex gap-2 items-start break-words"><input type="radio" className="mt-1 shrink-0" disabled={busy} name={row.field} checked={choices[row.field] === side} onChange={() => setChoices(previous => ({ ...previous, [row.field]: side }))} /><span className="min-w-0 break-words">{side === "target" ? "Основная" : "Дубль"}: {(side === "source" ? row.sourceDisplay : row.targetDisplay) ?? display(row[side])}</span></label>)}
      </fieldset>)}
      <Button className="h-auto w-full whitespace-normal" variant="outline" type="button" disabled={busy} onClick={() => setChoices(Object.fromEntries((Object.keys(MERGE_FIELDS) as MergeField[]).map(field => [field, "target"])))}>Выбрать значения основной карточки</Button>
      <label className="block" htmlFor="merge-reason">Причина объединения</label><Input id="merge-reason" maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} />
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Я проверил карточки: это один человек</label>
      <Button className="h-auto w-full whitespace-normal py-3" type="button" disabled={busy || !!missing || reason.trim().length < 3 || !confirmed} onClick={merge}>Объединить и сохранить историю</Button>
    </div>}
  </section>;
}
