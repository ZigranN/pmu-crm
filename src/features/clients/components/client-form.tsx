"use client";

import React from "react";
import { DuplicateReviewPanel } from "./duplicate-review";
import { reviewClientDuplicates } from "../server/duplicate-actions";
import type { DuplicateReview, DuplicateDecision } from "../server/deduplication";
import { canonicalPhone, canonicalInstagram } from "../contacts";
import { LANGUAGES, INTEREST_ZONES, CLIENT_KINDS, CLIENT_SOURCES } from "../administrative";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/form-section";
import { FormActionBar } from "@/components/shared/form-action-bar";
import { attemptCreateClientAction, updateClientAction, archiveClientAction } from "../server/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface ClientFormProps {
  initialData?: any;
}

export function ClientForm({ initialData }: ClientFormProps) {
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const submitting = React.useRef(false);
  const createRequest = React.useRef<{ key: string; payload: string } | null>(null);
  const [duplicates, setDuplicates] = React.useState<DuplicateReview | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const form = useForm<ClientSchema>({
    resolver: zodResolver(clientSchema),
    defaultValues: initialData ? {
      firstName: initialData.firstName,
      phone: initialData.phone,
      clientStatus: initialData.clientStatus,
      leadStatus: initialData.leadStatus ?? "",
      language: initialData.language ?? null,
      interestedZones: initialData.interestedZones ?? null,
      clientKind: initialData.clientKind ?? null,
      reportedPreviousPmu: initialData.reportedPreviousPmu ?? null,
      birthDate: initialData.birthDate ? new Date(initialData.birthDate) : null,
      lastName: initialData.lastName || "",
      whatsapp: initialData.whatsapp || "",
      email: initialData.email || "",
      instagram: initialData.instagram || "",
      source: initialData.source || "",
      notes: initialData.notes || "",
      tags: initialData.tags || "",
      referredByName: initialData.referredByName || "",
      interest: initialData.interest || "",
      nextContactAt: initialData.nextContactAt ? new Date(initialData.nextContactAt) : null,
      campaignTag: initialData.campaignTag || "",
      serviceTag: initialData.serviceTag || "",
    } : {
      language: null, interestedZones: null, clientKind: null, reportedPreviousPmu: null,
      firstName: "",
      lastName: "",
      phone: "",
      whatsapp: "",
      email: "",
      instagram: "",
      source: "",
      clientStatus: "new_lead",
      leadStatus: "",
      birthDate: null,
      notes: "",
      tags: "",
      referredByName: "",
      interest: "",
      nextContactAt: null,
      campaignTag: "",
      serviceTag: "",
    },
  });

  async function onSubmit(values: ClientSchema, decision?: DuplicateDecision) {
    if (submitting.current) return;
    submitting.current = true;
    setIsPending(true);
    try {
      if (values.phone !== initialData?.phone && !canonicalPhone(values.phone)) throw new Error("Укажите телефон с кодом страны, например +39 333 123 4567");
      if (values.whatsapp && values.whatsapp !== initialData?.whatsapp && !canonicalPhone(values.whatsapp)) throw new Error("Укажите WhatsApp с кодом страны");
      if (values.instagram && values.instagram !== initialData?.instagram && !canonicalInstagram(values.instagram)) throw new Error("Укажите Instagram handle или ссылку на профиль");
      if (initialData) {
        await updateClientAction(initialData.id, values);
        toast.success("Данные клиента обновлены");
      } else {
        const encoded = new TextEncoder().encode(JSON.stringify(values));
        const digest = await crypto.subtle.digest("SHA-256", encoded);
        const payload = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (!createRequest.current) {
          try { createRequest.current = JSON.parse(sessionStorage.getItem("pmu-client-create-request") ?? "null"); } catch { /* Storage may be disabled. */ }
        }
        if (!createRequest.current || createRequest.current.payload !== payload || typeof createRequest.current.key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(createRequest.current.key)) createRequest.current = { key: crypto.randomUUID(), payload };
        // Retain only a hash/key across reloads after an ambiguous network failure, never form data.
        try { sessionStorage.setItem("pmu-client-create-request", JSON.stringify(createRequest.current)); } catch { /* In-memory retries still retain the key. */ }
        const newClient = await attemptCreateClientAction(values, createRequest.current.key, decision);
        if (newClient.kind === "review") { setDuplicates(newClient.review); toast.info("Проверьте найденные совпадения"); return; }
        try { sessionStorage.removeItem("pmu-client-create-request"); } catch { /* No personal data is stored here. */ }
        toast.success("Клиент создан");
        router.push(`/clients/${newClient.id}`);
        return;
      }
      router.push(`/clients/${initialData.id}`);
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при сохранении");
    } finally {
      submitting.current = false;
      setIsPending(false);
    }
  }

  async function onArchive() {
    if (submitting.current) return;
    submitting.current = true;
    setIsPending(true);
    try {
      await archiveClientAction(initialData.id);
      toast.success("Клиент архивирован");
      router.push("/clients");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при архивации");
    } finally {
      submitting.current = false;
      setIsPending(false);
      setIsConfirmOpen(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={event => void form.handleSubmit(values => onSubmit(values))(event)} className="space-y-6 pb-24">
        <FormSection title="Личные данные">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Имя</FormLabel>
                  <FormControl>
                    <Input placeholder="Анна" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Фамилия</FormLabel>
                  <FormControl>
                    <Input placeholder="Смирнова" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl>
                    <Input placeholder="+39 333 123 4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="whatsapp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp (если отличается)</FormLabel>
                  <FormControl>
                    <Input placeholder="+39 333 123 4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="anna@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="instagram"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Instagram</FormLabel>
                  <FormControl>
                    <Input placeholder="@anna_pmu" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="birthDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата рождения</FormLabel>
                <FormControl>
                  <Input 
                    type="date" 
                    value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : ''} 
                    onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)} 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection title="Административные данные">
          <p className="text-sm text-muted-foreground">Сведения со слов клиента. Они не заменяют медицинскую оценку мастера.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="language" render={({ field }) => <FormItem><FormLabel>Язык общения</FormLabel><FormControl>
              <select className="border rounded p-2 w-full" value={field.value ?? ""} onChange={event => field.onChange(event.target.value || null)}><option value="">Не уточнён</option>{Object.entries(LANGUAGES).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select>
            </FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="clientKind" render={({ field }) => <FormItem><FormLabel>Тип клиента</FormLabel><FormControl>
              <select className="border rounded p-2 w-full" value={field.value ?? ""} onChange={event => field.onChange(event.target.value || null)}><option value="">Не уточнён</option>{Object.entries(CLIENT_KINDS).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select>
            </FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="reportedPreviousPmu" render={({ field }) => <FormItem><FormLabel>Предыдущий PMU со слов клиента</FormLabel><FormControl>
              <select className="border rounded p-2 w-full" value={field.value == null ? "unknown" : field.value ? "yes" : "no"} onChange={event => field.onChange(event.target.value === "unknown" ? null : event.target.value === "yes")}><option value="unknown">Не уточнено</option><option value="yes">Да</option><option value="no">Нет</option></select>
            </FormControl><FormMessage /></FormItem>} />
          </div>
          <FormField control={form.control} name="interestedZones" render={({ field }) => <FormItem><FormLabel>Интересующие зоны</FormLabel>
            <div className="flex flex-wrap gap-4">{Object.entries(INTEREST_ZONES).map(([code, label]) => <label key={code} className="flex gap-2 items-center"><input type="checkbox" checked={field.value?.includes(code as keyof typeof INTEREST_ZONES) ?? false} onChange={event => field.onChange(event.target.checked ? [...(field.value ?? []), code] : (field.value ?? []).filter(zone => zone !== code))} />{label}</label>)}</div>
            <p className="text-sm text-muted-foreground">{field.value === null ? "Интерес пока не уточнён" : field.value?.length === 0 ? "Зоны не выбраны" : "Можно выбрать несколько зон"}</p>
            <Button type="button" variant="ghost" onClick={() => field.onChange(null)}>Отметить интерес как неуточнённый</Button><FormMessage />
          </FormItem>} />
        </FormSection>

        <FormSection title="ПМ Учет">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="referredByName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Кто привел клиента</FormLabel>
                  <FormControl>
                    <Input placeholder="ФИО или контакт" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="interest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Интерес клиента</FormLabel>
                  <FormControl>
                    <Input placeholder="Например: ПМ губ, обучение" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {initialData?.treatmentZone && <p className="text-sm">Зона из старой карточки: {initialData.treatmentZone}. Уточните интересующие зоны в административных данных.</p>}
            <FormField
              control={form.control}
              name="nextContactAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Следующий контакт</FormLabel>
                  <FormControl>
                    <Input 
                      type="datetime-local" 
                      value={field.value instanceof Date ? new Date(field.value.getTime() - field.value.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} 
                      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="campaignTag"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marketing / ADV tag</FormLabel>
                  <FormControl>
                    <Input placeholder="ADS_FB_MAY" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="serviceTag"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service tag</FormLabel>
                  <FormControl>
                    <Input placeholder="POWDER_BROWS" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Системная информация">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="clientStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Статус</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите статус" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="new_lead">Новый лид</SelectItem>
                      <SelectItem value="contacted">Связались</SelectItem>
                      <SelectItem value="needs_consultation">Нужна консультация</SelectItem>
                      <SelectItem value="consultation_booked">Консультация назначена</SelectItem>
                      <SelectItem value="no_reply">Нет ответа</SelectItem>
                      <SelectItem value="appointment_booked">Записан на процедуру</SelectItem>
                      <SelectItem value="procedure_done">Процедура выполнена</SelectItem>
                      <SelectItem value="follow_up">Поддержка (follow-up)</SelectItem>
                      <SelectItem value="second_session_needed">Нужен второй сеанс</SelectItem>
                      <SelectItem value="correction_needed">Нужна коррекция</SelectItem>
                      <SelectItem value="completed">Завершено</SelectItem>
                      <SelectItem value="returning_client">Постоянный клиент</SelectItem>
                      <SelectItem value="refresh_needed">Нужен рефреш</SelectItem>
                      <SelectItem value="lost">Потерян</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Источник</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Откуда узнали?" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {field.value && !Object.hasOwn(CLIENT_SOURCES, field.value) && <SelectItem value={field.value}>{field.value} (из старой карточки)</SelectItem>}
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="referral">Рекомендация</SelectItem>
                      <SelectItem value="google">Google/Поиск</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="other">Другое</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="leadStatus"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Статус лида</FormLabel>
                <FormControl>
                  <Input placeholder="Например: горячий, холодный, в процессе" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tags"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Теги</FormLabel>
                <FormControl>
                  <Input placeholder="VIP, Рекомендация (через запятую)" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Заметки</FormLabel>
                <FormControl>
                  <Textarea placeholder="Административные заметки; медицинские сведения — в мед. карте" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        {initialData && <Button type="button" variant="outline" disabled={isPending} onClick={async () => {
          if (!await form.trigger()) return; setIsPending(true);
          try { setDuplicates(await reviewClientDuplicates(form.getValues(), initialData.id)); }
          catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось проверить совпадения"); }
          finally { setIsPending(false); }
        }}>Проверить совпадения</Button>}
        {duplicates && <DuplicateReviewPanel key={duplicates.token} review={duplicates} canConfirm={!initialData} pending={isPending} onConfirm={decision => void onSubmit(form.getValues(), decision)} />}
        <FormActionBar
          onSave={() => void form.handleSubmit(values => onSubmit(values))()}
          onCancel={() => router.back()}
          isSubmitting={isPending}
        >
          {initialData && (
            <Button
              type="button"
              variant="ghost"
              className="flex-1 md:flex-initial text-danger hover:bg-danger/10 hover:text-danger h-12 md:h-10"
              onClick={() => setIsConfirmOpen(true)}
              disabled={isPending}
            >
              Архивировать
            </Button>
          )}
        </FormActionBar>

        <ConfirmDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          onConfirm={onArchive}
          title="Архивировать клиента?"
          description="Клиент будет скрыт из общего списка. История посещений сохранится."
          variant="destructive"
          confirmLabel="Архивировать"
        />
      </form>
    </Form>
  );
}
