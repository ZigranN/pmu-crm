"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { serviceCategoryEnum, procedureTypeEnum } from "@/db/schema";
import { FormSection } from "@/components/shared/form-section";
import { MobileActionBar } from "@/components/shared/mobile-action-bar";
import { createServiceAction, updateServiceAction, archiveServiceAction, restoreServiceAction } from "../server/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface ServiceFormProps {
  initialData?: any;
}

export function ServiceForm({ initialData }: ServiceFormProps) {
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  const form = useForm<any>({
    resolver: zodResolver(serviceSchema),
    defaultValues: initialData ? {
      ...initialData,
      price: initialData.priceCents / 100,
    } : {
      name: "",
      description: "",
      category: "brows",
      procedureType: "brows",
      price: 0,
      durationMinutes: 120,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      requiresCorrection: false,
      isActive: true,
      correctionAfterDays: null,
    },
  });

  async function onSubmit(values: any) {
    setIsPending(true);
    try {
      if (initialData) {
        await updateServiceAction(initialData.id, values);
        toast.success("Услуга обновлена");
      } else {
        await createServiceAction(values);
        toast.success("Услуга создана");
      }
      router.push("/services");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Что-то пошло не так");
    } finally {
      setIsPending(false);
    }
  }

  async function onArchive() {
    setIsPending(true);
    try {
      await archiveServiceAction(initialData.id);
      toast.success("Услуга архивирована");
      router.push("/services");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при архивации");
    } finally {
      setIsPending(false);
      setIsConfirmOpen(false);
    }
  }

  async function onRestore() {
    setIsPending(true);
    try {
      await restoreServiceAction(initialData.id);
      toast.success("Услуга восстановлена");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Ошибка при восстановлении");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">
        <FormSection title="Основная информация">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Название</FormLabel>
                <FormControl>
                  <Input placeholder="Например: ПМ Бровей - Сфуматура" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Описание</FormLabel>
                <FormControl>
                  <Textarea placeholder="Краткое описание услуги..." {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Категория</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите категорию" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {serviceCategoryEnum.enumValues.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="procedureType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип процедуры</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тип" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {procedureTypeEnum.enumValues.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Стоимость и время">
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Стоимость (€)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                </FormControl>
                <FormDescription>Введите сумму в евро</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

            <FormField
              control={form.control}
              name="durationMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Длительность (минуты)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bufferBeforeMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Буфер до (мин)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bufferAfterMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Буфер после (мин)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
        </FormSection>

        <FormSection title="Дополнительно">
          <FormField
            control={form.control}
            name="requiresCorrection"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border border-borderSoft p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Требуется коррекция</FormLabel>
                  <FormDescription>
                    Система напомнит о необходимости записи на коррекцию
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {form.watch("requiresCorrection") && (
            <FormField
              control={form.control}
              name="correctionAfterDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Коррекция через (дней)</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} value={field.value || ""} onChange={(e) => field.onChange(parseInt(e.target.value) || null)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border border-borderSoft p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Активна</FormLabel>
                  <FormDescription>
                    Доступна ли услуга для записи
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
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
            {initialData.deletedAt ? (
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 text-success border-success/20 hover:bg-success/10"
                onClick={onRestore}
                disabled={isPending}
              >
                Восстановить из архива
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="w-full h-11 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setIsConfirmOpen(true)}
                disabled={isPending}
              >
                Архивировать услугу
              </Button>
            )}
          </div>
        )}

        <ConfirmDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          onConfirm={onArchive}
          title="Архивировать услугу?"
          description="Услуга будет скрыта из списка активных. Вы сможете восстановить её позже."
          variant="destructive"
          confirmLabel="Архивировать"
        />
      </form>
    </Form>
  );
}
