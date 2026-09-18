"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CommercialTermsPanel } from "../server/queries";
import { confirmTermsAction } from "../server/actions";
import type { TermsInput } from "../contract";

const money = (cents: number) => new Intl.NumberFormat("it-IT", {style: "currency", currency: "EUR"}).format(cents / 100);
export function TermsPanel({data}: {data: CommercialTermsPanel}) {
  const [source, setSource] = useState(""), [message, setMessage] = useState("");
  const [pending, start] = useTransition(), keys = useRef(new Map<string, string>()), router = useRouter();
  const date = (value: Date | string) => new Intl.DateTimeFormat("ru-RU", {timeZone: data.timezone, dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
  const price = data.options.find(option => `catalog:${option.serviceId}` === source);
  return <section className="space-y-4 rounded border p-4 min-w-0" aria-label="Коммерческие условия">
    <h2 className="text-xl font-semibold">Условия предложения</h2>
    <p>Срок подтверждается отдельно от следующего контакта. После него требуется решение человека; цена и записи автоматически не меняются.</p>
    {data.needsReview && <p role="status">Наступила дата пересмотра условий. Требуется подтверждение Owner/Admin.</p>}
    {!data.history.length && <p>Условия ещё не подтверждены.</p>}
    {data.history.map((row, index) => <article className="rounded border p-3 space-y-1 break-words" key={row.id}>
      <h3>{index === 0 ? "Текущие условия" : "История условий"} · редакция {row.revision}</h3>
      <p>{String(row.sourceSnapshot.serviceName)}</p>
      <p>{row.source === "catalog" ? `Цена зоны: ${money(row.amountCents!)}` : `Custom Offer: общий итог ${money(Number(row.sourceSnapshot.offerTotalCents))}. Это стоимость всех зон предложения; сумма на этот цикл не распределена.`}</p>
      <p>Подтверждено: {date(row.confirmedAt)} ({data.timezone}) · {row.actorName}</p>
      <p>Пересмотр: {date(row.reviewAt)} ({data.timezone})</p><p>Причина: {row.reason}</p>
    </article>)}
    {data.history.length === 50 && <p>Показаны последние 50 редакций.</p>}
    {data.canManage && data.blocked && <p>{data.blocked}</p>}
    {data.canManage && !data.blocked && <form className="space-y-3" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      start(async () => {
        try {
          const common = {cycleId: data.cycleId, expectedCycleVersion: data.cycleVersion, expectedRevision: data.history[0]?.revision ?? 0,
            reviewAt: new Date(String(form.get("reviewAt"))).toISOString(), reason: String(form.get("reason"))};
          const input: TermsInput = price ? {...common, source: "catalog", serviceId: price.serviceId, priceVersion: price.version,
            quotedCents: price.mode === "fixed" ? null : Math.round(Number(form.get("amount")) * 100)} : {...common, source: "offer", offerItemId: source.replace("offer:", "")};
          const signature = JSON.stringify(input), key = keys.current.get(signature) ?? crypto.randomUUID(); keys.current.set(signature, key);
          await confirmTermsAction(input, key); setMessage("Условия подтверждены"); router.refresh();
        } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось подтвердить условия"); }
      });
    }}>
      <label className="block">Источник условий<select required name="source" value={source} onChange={e => setSource(e.target.value)} className="block w-full rounded border p-2">
        <option value="">Выберите услугу или Custom Offer</option>
        {data.options.map(p => <option key={p.serviceId} value={`catalog:${p.serviceId}`}>{p.serviceName}{p.mode === "fixed" ? ` · ${money(p.priceCents!)}` : " · цена подтверждается человеком"}</option>)}
        {data.offers.map(o => <option key={o.id} value={`offer:${o.id}`}>{o.label}</option>)}
      </select></label>
      {price && price.mode !== "fixed" && <label className="block">Подтверждённая цена зоны (€)<input className="block w-full border p-2" name="amount" type="number" min="0" max="21474836.47" step="0.01" required /></label>}
      <label className="block">Пересмотреть условия (местное время устройства)<input className="block w-full min-w-0 border p-2" name="reviewAt" type="datetime-local" required /></label>
      <p className="text-sm">По ТЗ ориентир — одна неделя. Укажите согласованную дату явно. Для продления подтвердите новую редакцию с причиной.</p>
      <label className="block">Причина подтверждения условий<textarea className="block w-full border p-2" name="reason" minLength={3} maxLength={1000} required /></label>
      <button className="rounded border p-2" disabled={pending || !source} type="submit">Подтвердить условия</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
