import { z } from "zod";

export const paymentMethodEnumSchema = z.enum(["cash", "card", "bank_transfer", "other"]);

export const recordChargeSchema = z.object({
  clientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  cycleId: z.string().uuid().optional().nullable(),
  amountMinor: z.number().int().positive("Сумма начисления должна быть положительной"),
  currency: z.literal("EUR").default("EUR"),
  reason: z.string().trim().min(1, "Укажите причину начисления").max(1000),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const recordPaymentSchema = z.object({
  clientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  cycleId: z.string().uuid().optional().nullable(),
  amountMinor: z.number().int().positive("Сумма платежа должна быть положительной"),
  currency: z.literal("EUR").default("EUR"),
  paymentMethod: paymentMethodEnumSchema.default("cash"),
  reason: z.string().trim().min(1, "Укажите назначение платежа").max(1000).default("Оплата услуги"),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const recordRefundSchema = z.object({
  clientId: z.string().uuid(),
  targetPaymentId: z.string().uuid().optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
  amountMinor: z.number().int().positive("Сумма возврата должна быть положительной"),
  currency: z.literal("EUR").default("EUR"),
  reason: z.string().trim().min(1, "Укажите причину возврата").max(1000),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const recordAdjustmentSchema = z.object({
  clientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  cycleId: z.string().uuid().optional().nullable(),
  amountMinor: z.number().int().refine((v) => v !== 0, "Сумма корректировки не может быть 0"),
  currency: z.literal("EUR").default("EUR"),
  reason: z.string().trim().min(1, "Укажите основание корректировки").max(1000),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export type RecordChargeInput = z.input<typeof recordChargeSchema>;
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordRefundInput = z.input<typeof recordRefundSchema>;
export type RecordAdjustmentInput = z.input<typeof recordAdjustmentSchema>;
