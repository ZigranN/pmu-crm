"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/form-section";
import { MobileActionBar } from "@/components/shared/mobile-action-bar";
import { createClientAction, updateClientAction, archiveClientAction } from "../server/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface ClientFormProps {
  initialData?: any;
}

export function ClientForm({ initialData }: ClientFormProps) {
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  const form = useForm<ClientSchema>({
    resolver: zodResolver(clientSchema),
    defaultValues: initialData ? {
      ...initialData,
      birthDate: initialData.birthDate ? new Date(initialData.birthDate) : null,
      lastName: initialData.lastName || "",
      whatsapp: initialData.whatsapp || "",
      email: initialData.email || "",
      instagram: initialData.instagram || "",
      source: initialData.source || "",
      notes: initialData.notes || "",
      tags: initialData.tags || "",
    } : {
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
    },
  });

  async function onSubmit(values: ClientSchema) {
    setIsPending(true);
    try {
      if (initialData) {
        await updateClientAction(initialData.id, values);
        toast.success("Данные клиента обновлены");
      } else {
        const newClient = await createClientAction(values);
        toast.success("Клиент создан");
        router.push(`/clients/${newClient.id}`);
        return;
      }
      router.push(`/clients/${initialData.id}`);
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при сохранении");
    } finally {
      setIsPending(false);
    }
  }

  async function onArchive() {
    setIsPending(true);
    try {
      await archiveClientAction(initialData.id);
      toast.success("Клиент архивирован");
      router.push("/clients");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при архивации");
    } finally {
      setIsPending(false);
      setIsConfirmOpen(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">
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
                    <Input placeholder="+7 (999) 000-00-00" {...field} />
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
                    <Input placeholder="+7 (999) 000-00-00" {...field} />
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
                      <SelectItem value="appointment_booked">Записан</SelectItem>
                      <SelectItem value="procedure_done">Процедура выполнена</SelectItem>
                      <SelectItem value="returning_client">Постоянный</SelectItem>
                      <SelectItem value="completed">Завершено</SelectItem>
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
                  <Input placeholder="VIP, Скидка, Проблемная кожа (через запятую)" {...field} />
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
                  <Textarea placeholder="Важная информация о клиенте..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <MobileActionBar>
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-taupe hover:bg-espresso text-ivory h-11"
            disabled={isPending}
          >
            Сохранить
          </Button>
        </MobileActionBar>

        {initialData && (
          <div className="pt-4">
            <Button
              type="button"
              variant="ghost"
              className="w-full h-11 text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => setIsConfirmOpen(true)}
              disabled={isPending}
            >
              Архивировать клиента
            </Button>
          </div>
        )}

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
