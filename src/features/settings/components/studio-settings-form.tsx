"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { studioSettingsSchema, type StudioSettingsSchema } from "../schemas/studio-settings.schema";
import { updateStudioSettingsAction } from "../server/actions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { ImageUpload } from "@/features/media/components/image-upload";

interface StudioSettingsFormProps {
  initialData: any;
  readonly?: boolean;
}

export function StudioSettingsForm({ initialData, readonly = false }: StudioSettingsFormProps) {
  const [isPending, setIsPending] = useState(false);

  const form = useForm<any>({
    resolver: zodResolver(studioSettingsSchema),
    defaultValues: {
      name: initialData?.name || "",
      slug: initialData?.slug || "",
      logoUrl: initialData?.logoUrl || "",
      address: initialData?.address || "",
      city: initialData?.city || "",
      country: initialData?.country || "",
      timezone: initialData?.timezone || "Europe/Rome",
      whatsappNumber: initialData?.whatsappNumber || "",
      phone: initialData?.phone || "",
      email: initialData?.email || "",
      instagram: initialData?.instagram || "",
    },
  });

  async function onSubmit(values: any) {
    if (readonly) return;
    setIsPending(true);
    try {
      await updateStudioSettingsAction(values);
      toast.success("Настройки студии обновлены");
    } catch (error: any) {
      toast.error(error.message || "Ошибка при обновлении настроек");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Основные настройки</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название студии</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug (URL идентификатор)</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Логотип студии</FormLabel>
                    <FormControl>
                      <ImageUpload
                        value={field.value}
                        onChange={field.onChange}
                        onRemove={() => field.onChange("")}
                        disabled={readonly || isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Контакты и соцсети</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="whatsappNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
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
                    <Input {...field} disabled={readonly} />
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
                    <Input {...field} type="email" disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Адрес и часовой пояс</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Страна</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Город</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Адрес</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Часовой пояс</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {!readonly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending} className="bg-taupe hover:bg-espresso text-ivory">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Сохранить изменения
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
