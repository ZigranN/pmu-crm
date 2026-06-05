"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { masterSchema, type MasterSchema } from "../schemas/master.schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormSection } from "@/components/shared/form-section";
import { FormActionBar } from "@/components/shared/form-action-bar";
import { createMasterAction, updateMasterAction, archiveMasterAction, restoreMasterAction } from "../server/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageUpload } from "@/features/media/components/image-upload";

interface MasterFormProps {
  initialData?: any;
  availableServices: any[];
}

export function MasterForm({ initialData, availableServices }: MasterFormProps) {
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  const form = useForm<MasterSchema>({
    resolver: zodResolver(masterSchema),
    defaultValues: initialData ? {
      ...initialData,
      serviceIds: initialData.services?.map((s: any) => s.serviceId) || [],
    } : {
      displayName: "",
      phone: "",
      email: "",
      bio: "",
      photoUrl: "",
      calendarColor: "#8B6F5A",
      isActive: true,
      serviceIds: [],
    },
  });

  async function onSubmit(values: MasterSchema) {
    setIsPending(true);
    try {
      if (initialData) {
        await updateMasterAction(initialData.id, values);
        toast.success("Мастер обновлен");
      } else {
        await createMasterAction(values);
        toast.success("Мастер создан");
      }
      router.push("/masters");
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
      await archiveMasterAction(initialData.id);
      toast.success("Мастер архивирован");
      router.push("/masters");
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
      await restoreMasterAction(initialData.id);
      toast.success("Мастер восстановлен");
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
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Имя мастера</FormLabel>
                <FormControl>
                  <Input placeholder="Например: Анна Смирнова" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="master@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>О мастере</FormLabel>
                <FormControl>
                  <Textarea placeholder="Краткая биография или специализация..." {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="photoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Фото мастера</FormLabel>
                <FormControl>
                  <ImageUpload
                    value={field.value}
                    onChange={field.onChange}
                    onRemove={() => field.onChange("")}
                    disabled={isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection title="Настройки календаря">
          <FormField
            control={form.control}
            name="calendarColor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Цвет в календаре</FormLabel>
                <div className="flex items-center gap-3">
                  <FormControl>
                    <Input type="color" {...field} className="h-10 w-20 p-1" />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">{field.value}</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border border-borderSoft p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Активен</FormLabel>
                  <FormDescription>
                    Отображается ли мастер в списке для записи
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

        <FormSection title="Услуги мастера" description="Выберите услуги, которые выполняет данный мастер">
          <FormField
            control={form.control}
            name="serviceIds"
            render={() => (
              <FormItem>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {availableServices.map((service) => (
                    <FormField
                      key={service.id}
                      control={form.control}
                      name="serviceIds"
                      render={({ field }) => {
                        return (
                          <FormItem
                            key={service.id}
                            className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(service.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...field.value!, service.id])
                                    : field.onChange(
                                        field.value?.filter(
                                          (value) => value !== service.id
                                        )
                                      );
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">
                              {service.name}
                            </FormLabel>
                          </FormItem>
                        );
                      }}
                    />
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormActionBar
          onSave={form.handleSubmit(onSubmit)}
          onCancel={() => router.back()}
          isSubmitting={isPending}
        >
          {initialData && !initialData.deletedAt && (
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
          {initialData && initialData.deletedAt && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 md:flex-initial text-success border-success/20 hover:bg-success/10 h-12 md:h-10"
              onClick={onRestore}
              disabled={isPending}
            >
              Восстановить
            </Button>
          )}
        </FormActionBar>

        <ConfirmDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          onConfirm={onArchive}
          title="Архивировать мастера?"
          description="Мастер будет скрыт из списка активных. Все записи останутся в системе."
          variant="destructive"
          confirmLabel="Архивировать"
        />
      </form>
    </Form>
  );
}
