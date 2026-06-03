"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";
import { updateMedicalProfileAction } from "../server/medical-actions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2 } from "lucide-react";

interface MedicalProfileFormProps {
  clientId: string;
  initialData?: any;
  readonly?: boolean;
}

export function MedicalProfileForm({ clientId, initialData, readonly = false }: MedicalProfileFormProps) {
  const [isPending, setIsPending] = useState(false);

  const form = useForm<MedicalProfileSchema>({
    resolver: zodResolver(medicalProfileSchema),
    defaultValues: {
      allergies: initialData?.allergies || "",
      contraindications: initialData?.contraindications || "",
      skinType: initialData?.skinType || "",
      pregnancyStatus: initialData?.pregnancyStatus || "",
      medications: initialData?.medications || "",
      previousPMU: !!initialData?.previousPMU,
      previousPMUNotes: initialData?.previousPMUNotes || "",
      herpesHistory: !!initialData?.herpesHistory,
      diabetes: !!initialData?.diabetes,
      bloodThinners: !!initialData?.bloodThinners,
      keloidRisk: !!initialData?.keloidRisk,
      autoimmuneDiseases: !!initialData?.autoimmuneDiseases,
      recentBotoxFillers: !!initialData?.recentBotoxFillers,
      recentPeelingLaser: !!initialData?.recentPeelingLaser,
      skinSensitivity: !!initialData?.skinSensitivity,
      medicalNotes: initialData?.medicalNotes || "",
    },
  });

  async function onSubmit(values: MedicalProfileSchema) {
    if (readonly) return;
    setIsPending(true);
    try {
      await updateMedicalProfileAction(clientId, values);
      toast.success("Медицинский профиль обновлен");
    } catch (error: any) {
      toast.error(error.message || "Ошибка при обновлении профиля");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Общая информация</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="skinType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип кожи</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} placeholder="Напр. жирная, сухая" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="allergies"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Аллергии</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} placeholder="Есть ли аллергии?" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <FormField
                control={form.control}
                name="contraindications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Противопоказания</FormLabel>
                    <FormControl>
                      <Textarea {...field} disabled={readonly} placeholder="Перечислите противопоказания" value={field.value ?? ""} />
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
            <CardTitle className="text-lg">Состояние здоровья</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              control={form.control}
              name="pregnancyStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Беременность / ГВ</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={readonly} placeholder="Укажите статус" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">
              <FormField
                control={form.control}
                name="medications"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Принимаемые препараты</FormLabel>
                    <FormControl>
                      <Textarea {...field} disabled={readonly} placeholder="Перечислите принимаемые лекарства" value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="diabetes"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Диабет</FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="herpesHistory"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Герпес в анамнезе</FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bloodThinners"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Препараты разжиж. кровь</FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="keloidRisk"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Склонность к келоидам</FormLabel>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="autoimmuneDiseases"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Аутоиммунные заболевания</FormLabel>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Прошлый опыт и процедуры</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="previousPMU"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readonly}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Ранее был перманентный макияж</FormLabel>
                  </div>
                </FormItem>
              )}
            />
            {form.watch("previousPMU") && (
              <FormField
                control={form.control}
                name="previousPMUNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Детали прошлого ПМ</FormLabel>
                    <FormControl>
                      <Textarea {...field} disabled={readonly} placeholder="Где, когда, какой техникой?" value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="recentBotoxFillers"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={readonly}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Ботокс / Филлеры (недавно)</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recentPeelingLaser"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={readonly}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Пилинг / Лазер (недавно)</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="skinSensitivity"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={readonly}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Повышенная чувствительность</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Дополнительные заметки</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="medicalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea {...field} disabled={readonly} placeholder="Любая дополнительная медицинская информация" value={field.value ?? ""} />
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
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить анкету
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
