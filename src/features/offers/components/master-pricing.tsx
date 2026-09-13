"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PriceOption } from "../server/queries";
import { saveMasterPrice } from "../server/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestKey, parseEuro, euro } from "./request-key";
export function MasterPriceForm({ option }: { option: PriceOption }) {
  const router = useRouter(), busy = useRef(false);
  const [value, setValue] = useState(option.overridePriceCents === null ? "" : String(option.overridePriceCents / 100));
  const [reason, setReason] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  return <form className="border rounded p-4 space-y-3" onSubmit={async event => {
    event.preventDefault(); if (busy.current) return; busy.current = true; setPending(true); setMessage("");
    const storageKey = `pmu-price:${option.serviceId}:${option.masterId}`;
    try {
      const payload = { serviceId: option.serviceId, masterId: option.masterId!, priceCents: value.trim() === "" ? null : parseEuro(value), expectedRevision: option.overrideRevision, reason };
      await saveMasterPrice(payload, await requestKey(storageKey, payload)); sessionStorage.removeItem(storageKey); setReason(""); setMessage("Цена сохранена"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить цену"); }
    finally { busy.current = false; setPending(false); }
  }}>
    <h2 className="font-semibold">{option.masterName}</h2>
    <p>{option.source === "master_override" ? `Цена мастера: ${euro(option.priceCents!)}` : "Используются условия базового каталога"}</p>
    <fieldset disabled={pending} className="space-y-2">
      <label htmlFor={`override-${option.masterId}`}>Цена мастера (€)</label><Input id={`override-${option.masterId}`} inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} />
      <p className="text-sm">Пустое поле возвращает базовую цену или режим определения цены из каталога.</p>
      <label htmlFor={`override-reason-${option.masterId}`}>Причина изменения</label><Input id={`override-reason-${option.masterId}`} required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
      <Button type="submit">Сохранить цену мастера</Button>
    </fieldset><p role="status">{message}</p>
  </form>;
}
