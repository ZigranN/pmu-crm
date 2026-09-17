"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importPhase3Catalog, consolidateServices } from "../server/actions";
export function CatalogImport() {
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""); const router = useRouter();
  return <div className="space-y-2"><p className="text-sm">Добавить 13 услуг из ТЗ. Существующие цены и архивные записи останутся без изменений.</p>
    <Button disabled={pending} onClick={async () => { setPending(true); try { const result = await importPhase3Catalog(); setMessage(`Добавлено: ${result.created}`); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка импорта"); } finally { setPending(false); } }}>Добавить каталог из ТЗ</Button><p role="status">{message}</p></div>;
}
export function LegacyServiceCleanup({ canonicalId, rows }: { canonicalId: string; rows: { id: string; name: string; priceCents: number | null }[] }) {
  const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState(""); const router = useRouter();
  if (!rows.length) return null;
  return <section className="space-y-3 border rounded p-4"><h2 className="font-semibold">Разбор старых дублей</h2>
    <p className="text-sm">Выберите только записи, обозначающие эту же услугу. Они будут архивированы со ссылкой на основную запись; старые визиты и их цены не изменятся.</p>
    {rows.map(row => <label key={row.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(before => event.target.checked ? [...before, row.id] : before.filter(id => id !== row.id))} />{row.name} · {row.priceCents === null ? "нет цены" : `${row.priceCents / 100} €`}</label>)}
    <Input aria-label="Причина объединения услуг" value={reason} onChange={event => setReason(event.target.value)} placeholder="Почему это дубли одной услуги" />
    <Button disabled={pending || !selected.length || reason.trim().length < 3} onClick={async () => { setPending(true); try { await consolidateServices({ canonicalId, duplicateIds: selected, reason }); setSelected([]); setMessage("Дубли архивированы, история сохранена"); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка объединения"); } finally { setPending(false); } }}>Архивировать выбранные дубли</Button><p role="status">{message}</p>
  </section>;
}
