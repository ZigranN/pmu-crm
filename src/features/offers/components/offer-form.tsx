"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveOffer } from "../server/actions";
import type { OfferWorkspace } from "../server/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestKey, euro, parseEuro } from "./request-key";
const optionKey = (serviceId: string, masterId: string | null) => `${serviceId}:${masterId ?? "base"}`;
type Line = { key: string; standard: string };
export function OfferForm({ clientId, workspace }: { clientId: string; workspace: OfferWorkspace }) {
  const router = useRouter(), busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ offerId: string; revision: number } | null>(null);
  const [lines, setLines] = useState<Line[]>([{ key: "", standard: "" }, { key: "", standard: "" }]);
  const [agreed, setAgreed] = useState(""), [reason, setReason] = useState("");
  const { options, revisions } = workspace;
  let standardTotal: number | null = null, agreedTotal: number | null = null;
  try {
    standardTotal = lines.reduce((total, line) => { const selected = options.find(row => optionKey(row.serviceId, row.masterId) === line.key);
      if (!selected) throw new Error("Incomplete selection"); return total + (selected.mode === "fixed" ? selected.priceCents! : parseEuro(line.standard)); }, 0);
    if (agreed.trim()) agreedTotal = parseEuro(agreed);
  } catch { /* Show totals only after all required prices have been entered. */ }
  const reset = () => { setEditing(null); setLines([{ key: "", standard: "" }, { key: "", standard: "" }]); setAgreed(""); setReason(""); };
  return <div className="space-y-8">
    <p>Индивидуальное предложение для нескольких зон PMU вне стандартного пакета Total Face. Сохранение фиксирует согласованные условия; каждая корректировка создаёт новую версию.</p>
    {workspace.canManage && <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (busy.current) return; busy.current = true; setPending(true); setError(""); setMessage("");
      const storageKey = `pmu-offer:${clientId}:${editing?.offerId ?? "new"}`;
      try {
        const payload = { offerId: editing?.offerId ?? null, clientId, expectedRevision: editing?.revision ?? 0, agreedTotalCents: parseEuro(agreed), reason,
          items: lines.map(line => { const option = options.find(row => optionKey(row.serviceId, row.masterId) === line.key); if (!option) throw new Error("Выберите доступную услугу");
            return { serviceId: option.serviceId, masterId: option.masterId, priceVersion: option.version, standardCents: option.mode === "fixed" ? null : parseEuro(line.standard) }; }) };
        await saveOffer(payload, await requestKey(storageKey, payload)); sessionStorage.removeItem(storageKey); reset(); setMessage("Предложение сохранено"); router.refresh();
      } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить предложение"); }
      finally { busy.current = false; setPending(false); }
    }}>
      <h2 className="font-semibold">{editing ? `Новая версия предложения (текущая: ${editing.revision})` : "Новое предложение"}</h2>
      <fieldset disabled={pending} className="space-y-4">
        {lines.map((line, index) => {
          const selected = options.find(row => optionKey(row.serviceId, row.masterId) === line.key);
          return <div key={index} className="rounded border p-3 space-y-2">
            <label htmlFor={`offer-service-${index}`}>Услуга и мастер — зона {index + 1}</label>
            <select id={`offer-service-${index}`} className="w-full min-w-0 border rounded p-2" required value={line.key} onChange={event => setLines(before => before.map((row, i) => i === index ? { key: event.target.value, standard: "" } : row))}>
              <option value="">Выберите услугу</option>{options.map(row => <option key={optionKey(row.serviceId, row.masterId)} value={optionKey(row.serviceId, row.masterId)}>{row.serviceName} · {row.masterName ?? "Базовая цена"}</option>)}
            </select>
            {selected && (selected.mode === "fixed" ? <p>Стандартная цена: {euro(selected.priceCents!)}</p> : <>
              <p>{selected.priceCents === null ? "Цена определяется человеком" : `Ориентир: ${euro(selected.priceCents)}${selected.priceMaxCents !== null ? ` – ${euro(selected.priceMaxCents)}` : ""}`}</p>
              <label htmlFor={`offer-standard-${index}`}>Подтверждённая стандартная цена — зона {index + 1} (€)</label>
              <Input id={`offer-standard-${index}`} inputMode="decimal" value={line.standard} required onChange={event => setLines(before => before.map((row, i) => i === index ? { ...row, standard: event.target.value } : row))} />
            </>)}
          </div>;
        })}
        <Button type="button" variant="outline" onClick={() => setLines(before => before.length === 2 ? [...before, { key: "", standard: "" }] : before.slice(0, 2))}>{lines.length === 2 ? "Добавить третью зону" : "Убрать третью зону"}</Button>
        <div><label htmlFor="offer-agreed">Согласованная итоговая цена (€)</label><Input id="offer-agreed" inputMode="decimal" required value={agreed} onChange={event => setAgreed(event.target.value)} /></div>
        {standardTotal !== null && <p aria-label="Расчёт предложения">Стандартная сумма: {euro(standardTotal)}{agreedTotal !== null ? ` · Скидка: ${euro(Math.max(0, standardTotal - agreedTotal))}` : ""}</p>}
        <div><label htmlFor="offer-reason">Причина предложения / изменения цены</label><Input id="offer-reason" required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><Button type="submit">Сохранить предложение</Button>{editing && <Button type="button" variant="outline" onClick={reset}>Новое предложение</Button>}</div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="text-red-700">{error}</p>}<p role="status">{message}</p>
    <section className="space-y-4"><h2 className="font-semibold">История предложений</h2>
      {!revisions.length && <p>Предложений пока нет.</p>}
      {revisions.map(revision => <article key={revision.id} className="border rounded p-3 space-y-2 break-words">
        <h3>Версия {revision.revision} · {new Date(revision.createdAt).toLocaleString("ru-RU")}</h3>
        {revision.items.map(item => <p key={item.id}>{item.serviceName} · {item.masterName ?? "Без выбора мастера"}: {euro(item.standardCents)}</p>)}
        <p>Стандартная сумма: {euro(revision.standardTotalCents)} · Согласовано: {euro(revision.agreedTotalCents)} · Скидка: {euro(revision.discountCents)}</p>
        <p>Причина: {revision.reason}</p><p className="text-sm">Утвердил: {revision.approverName}</p>
        {workspace.canManage && !revisions.some(row => row.offerId === revision.offerId && row.revision > revision.revision) && <Button type="button" variant="outline" disabled={pending} onClick={() => {
          setEditing({ offerId: revision.offerId, revision: revision.revision }); setLines(revision.items.map(item => ({ key: optionKey(item.serviceId, item.masterId), standard: String(item.standardCents / 100) })));
          setAgreed(String(revision.agreedTotalCents / 100)); setReason(""); setMessage(""); setError(""); window.scrollTo({ top: 0, behavior: "smooth" });
        }}>Изменить предложение</Button>}
      </article>)}
    </section>
  </div>;
}
