import { z } from "zod";
const euros = z.number().finite().min(0).max(21474836.47).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Не более двух знаков после запятой").nullable();
export const serviceSchema = z.object({
  catalogCode: z.string().min(1, "Выберите услугу из справочника"),
  description: z.string().max(4000).optional(),
  priceMode: z.enum(["fixed", "estimate", "range", "master_quote"]),
  price: euros, priceMax: euros,
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  preparationTemplateId: z.string().uuid().nullable(), postCareTemplateId: z.string().uuid().nullable(),
  isActive: z.boolean(),
}).strict().superRefine((data, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (data.isActive && data.durationMinutes === null) issue("durationMinutes", "Для активной услуги нужна длительность");
  if (data.priceMode === "master_quote") {
    if (data.price !== null || data.priceMax !== null) issue("price", "Цена определяется мастером: суммы должны быть пустыми");
  } else if (data.price === null) issue("price", "Укажите базовую цену или ориентир");
  if (data.priceMode === "range") {
    if (data.priceMax === null || (data.price !== null && data.priceMax < data.price)) issue("priceMax", "Верхняя граница должна быть не меньше нижней");
  } else if (data.priceMax !== null) issue("priceMax", "Верхняя граница применяется только к диапазону");
});
export type ServiceSchema = z.infer<typeof serviceSchema>;
