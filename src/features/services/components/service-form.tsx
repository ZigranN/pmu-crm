"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import type { services, serviceDefinitions } from "@/db/schema";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { CATALOG_CATEGORIES, CATALOG_ZONES, CATALOG_TECHNIQUES, SESSION_LABELS } from "../catalog";
import { createServiceAction, updateServiceAction, archiveServiceAction, restoreServiceAction } from "../server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/shared/form-section";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

type Template = { id: string; name: string; category: string };
type Props = { initialData?: typeof services.$inferSelect; definitions: (typeof serviceDefinitions.$inferSelect)[]; templates: Template[] };
const blank: ServiceSchema = { catalogCode: "", description: "", priceMode: "master_quote", price: null, priceMax: null,
  durationMinutes: null, preparationTemplateId: null, postCareTemplateId: null, isActive: false };
const selectClass = "w-full rounded-md border bg-white p-2 min-h-11";
export function ServiceForm({ initialData, definitions, templates }: Props) {
  const router = useRouter(), submitting = useRef(false), request = useRef<{ payload: string; key: string } | null>(null);
  const [pending, setPending] = useState(false), [confirm, setConfirm] = useState(false), [error, setError] = useState("");
  const [values, setValues] = useState<ServiceSchema>(initialData?.catalogVersion === 1 ? {
    catalogCode: initialData.catalogCode!, description: initialData.description ?? "", priceMode: initialData.priceMode as ServiceSchema["priceMode"],
    price: initialData.priceCents === null ? null : initialData.priceCents / 100, priceMax: initialData.priceMaxCents === null ? null : initialData.priceMaxCents / 100,
    durationMinutes: initialData.durationMinutes, preparationTemplateId: initialData.preparationTemplateId,
    postCareTemplateId: initialData.postCareTemplateId, isActive: initialData.isActive,
  } : blank);
  const definition = definitions.find(row => row.code === values.catalogCode);
  const set = <K extends keyof ServiceSchema>(key: K, value: ServiceSchema[K]) => setValues(before => ({ ...before, [key]: value }));
  function choose(code: string) {
    const row = definitions.find(item => item.code === code);
    if (!row) { setValues(blank); return; }
    setValues({ ...blank, catalogCode: code, priceMode: row.priceMode as ServiceSchema["priceMode"], price: row.priceCents === null ? null : row.priceCents / 100,
      priceMax: row.priceMaxCents === null ? null : row.priceMaxCents / 100, durationMinutes: row.durationMinutes, isActive: row.durationMinutes !== null });
  }
  async function run(action: () => Promise<unknown>, message: string) {
    if (submitting.current) return; submitting.current = true; setPending(true); setError("");
    try { await action(); toast.success(message); router.push("/services"); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить услугу"); }
    finally { submitting.current = false; setPending(false); setConfirm(false); }
  }
  async function save() {
    const parsed = serviceSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await run(async () => {
      if (initialData) return updateServiceAction(initialData.id, parsed.data);
      const payload = JSON.stringify(parsed.data);
      if (!request.current || request.current.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
      return createServiceAction(parsed.data, request.current.key);
    }, "Услуга сохранена");
  }
  if (initialData?.supersededById) return <p>Эта запись сохранена как дубль. <Link className="underline" href={`/services/${initialData.supersededById}/edit`}>Открыть основную услугу</Link></p>;
  return <form className="space-y-6 pb-24" onSubmit={event => { event.preventDefault(); void save(); }}>
    {initialData?.catalogVersion === 0 && <div className="rounded border p-3"><p>Старая запись: {initialData.name}. Выберите соответствующую услугу и проверьте условия перед сохранением.</p>
      <p>Сохранённая цена: {initialData.priceCents === null ? "не указана" : `${initialData.priceCents / 100} €`}; длительность: {initialData.durationMinutes ?? "не указана"} мин. Старый ID и история сохранятся.</p></div>}
    <fieldset disabled={pending || !!initialData?.deletedAt} className="space-y-6">
      <FormSection title="Услуга">
        <label htmlFor="catalog-code">Услуга из справочника</label>
        <select id="catalog-code" className={selectClass} value={values.catalogCode} disabled={!!initialData?.catalogCode} onChange={event => choose(event.target.value)} required>
          <option value="">Выберите услугу</option>{definitions.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
        </select>
        {definition && <dl className="grid gap-2 text-sm">
          <div><dt>Категория</dt><dd>{CATALOG_CATEGORIES.find(row => row.code === definition.categoryCode)?.label}</dd></div>
          <div><dt>Зона</dt><dd>{CATALOG_ZONES.find(row => row.code === definition.zoneCode)?.label}</dd></div>
          <div><dt>Техника</dt><dd>{CATALOG_TECHNIQUES.find(row => row.code === definition.techniqueCode)?.label}</dd></div>
          <div><dt>Модель сессий</dt><dd>{SESSION_LABELS[definition.sessionsModel]}</dd></div>
        </dl>}
        <label htmlFor="service-description">Описание</label><Textarea id="service-description" value={values.description ?? ""} onChange={event => set("description", event.target.value)} maxLength={4000} />
      </FormSection>
      <FormSection title="Базовая стоимость">
        <label htmlFor="price-mode">Как определяется цена</label>
        <select id="price-mode" className={selectClass} value={values.priceMode} onChange={event => {
          const priceMode = event.target.value as ServiceSchema["priceMode"];
          setValues(before => ({ ...before, priceMode, price: priceMode === "master_quote" ? null : before.price, priceMax: priceMode === "range" ? before.priceMax : null }));
        }}>
          <option value="fixed">Фиксированная базовая цена</option><option value="estimate">Ориентир</option><option value="range">Диапазон-ориентир</option><option value="master_quote">Определяется мастером</option>
        </select>
        {values.priceMode !== "master_quote" && <><label htmlFor="service-price">Базовая цена / нижняя граница (€)</label>
          <Input id="service-price" type="number" min="0" step="0.01" value={values.price ?? ""} onChange={event => set("price", event.target.value === "" ? null : Number(event.target.value))} required /></>}
        {values.priceMode === "range" && <><label htmlFor="service-price-max">Верхняя граница (€)</label>
          <Input id="service-price-max" type="number" min="0" step="0.01" value={values.priceMax ?? ""} onChange={event => set("priceMax", event.target.value === "" ? null : Number(event.target.value))} required /></>}
        <p className="text-sm text-muted-foreground">Это условия каталога, а не согласованная цена конкретного клиента. Для Remover цена указана за один сеанс.</p>
      </FormSection>
      <FormSection title="Длительность и материалы">
        <label htmlFor="service-duration">Длительность (минуты)</label>
        <Input id="service-duration" type="number" min="5" max="1440" step="1" readOnly={definition?.durationMinutes != null} value={values.durationMinutes ?? ""} onChange={event => set("durationMinutes", event.target.value === "" ? null : Number(event.target.value))} />
        <p className="text-sm text-muted-foreground">Время включает подготовку и уборку; дополнительный буфер — 0. Если длительность не определена, услуга остаётся неактивной.</p>
        {([['preparationTemplateId', 'Шаблон подготовки', 'preparation'], ['postCareTemplateId', 'Шаблон постухода', 'post_care']] as const).map(([field, label, category]) => <div key={field}>
          <label htmlFor={field}>{label}</label><select id={field} className={selectClass} value={values[field] ?? ""} onChange={event => set(field, event.target.value || null)}>
            <option value="">Не назначен</option>{templates.filter(row => row.category === category).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></div>)}
        <label className="flex gap-3 items-center"><input type="checkbox" checked={values.isActive} onChange={event => set("isActive", event.target.checked)} />Активна</label>
      </FormSection>
      <Button type="submit" disabled={pending}>Сохранить</Button>
    </fieldset>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-3 flex-wrap"><Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Отмена</Button>
      {initialData && !initialData.deletedAt && <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirm(true)}>Архивировать</Button>}
      {initialData?.deletedAt && <Button type="button" disabled={pending} onClick={() => void run(() => restoreServiceAction(initialData.id), "Услуга восстановлена")}>Восстановить</Button>}
    </div>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Архивировать услугу?" description="ID, визиты и история сохраняются." confirmLabel="Архивировать" onConfirm={() => { if (initialData) void run(() => archiveServiceAction(initialData.id), "Услуга архивирована"); }} />
  </form>;
}
