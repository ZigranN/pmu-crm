"use client";

import React, { useState } from "react";
import { formatCents } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PlusCircle,
  RotateCcw,
  SlidersHorizontal,
  ArrowDownRight,
  CheckCircle2,
} from "lucide-react";
import {
  recordPaymentAction,
  recordRefundAction,
  recordAdjustmentAction,
} from "../server/actions";
import type { FinancialSummary, LedgerEntryRecord } from "../domain/types";

interface ClientFinancialPanelProps {
  clientId: string;
  summary: FinancialSummary;
  entries: LedgerEntryRecord[];
  canManageFinance: boolean;
  onRefresh?: () => void;
}

export function ClientFinancialPanel({
  clientId,
  summary,
  entries,
  canManageFinance,
  onRefresh,
}: ClientFinancialPanelProps) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const [amountInput, setAmountInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [methodInput, setMethodInput] = useState<"cash" | "card" | "bank_transfer" | "other">("cash");
  const [targetPaymentId, setTargetPaymentId] = useState<string>("");
  const [adjustmentSign, setAdjustmentSign] = useState<"credit" | "debit">("credit");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Math.round(parseFloat(amountInput.replace(",", ".")) * 100);
    if (isNaN(amount) || amount <= 0) {
      setError("Введите корректную положительную сумму");
      return;
    }

    setLoading(true);
    try {
      await recordPaymentAction({
        clientId,
        amountMinor: amount,
        currency: "EUR",
        paymentMethod: methodInput,
        reason: reasonInput.trim() || "Оплата услуги",
      });
      setPaymentOpen(false);
      setAmountInput("");
      setReasonInput("");
      onRefresh?.();
    } catch (err: any) {
      setError(err?.message || "Ошибка записи платежа");
    } finally {
      setLoading(false);
    }
  };

  const handleRecordRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Math.round(parseFloat(amountInput.replace(",", ".")) * 100);
    if (isNaN(amount) || amount <= 0) {
      setError("Введите корректную положительную сумму");
      return;
    }
    if (!reasonInput.trim()) {
      setError("Укажите причину возврата");
      return;
    }

    setLoading(true);
    try {
      await recordRefundAction({
        clientId,
        targetPaymentId: targetPaymentId ? targetPaymentId : undefined,
        amountMinor: amount,
        currency: "EUR",
        reason: reasonInput.trim(),
      });
      setRefundOpen(false);
      setAmountInput("");
      setReasonInput("");
      setTargetPaymentId("");
      onRefresh?.();
    } catch (err: any) {
      setError(err?.message || "Ошибка записи возврата");
    } finally {
      setLoading(false);
    }
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const rawAmount = Math.round(parseFloat(amountInput.replace(",", ".")) * 100);
    if (isNaN(rawAmount) || rawAmount === 0) {
      setError("Введите ненулевую сумму корректировки");
      return;
    }
    if (!reasonInput.trim()) {
      setError("Укажите основание корректировки");
      return;
    }

    const amountMinor = adjustmentSign === "credit" ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    setLoading(true);
    try {
      await recordAdjustmentAction({
        clientId,
        amountMinor,
        currency: "EUR",
        reason: reasonInput.trim(),
      });
      setAdjustmentOpen(false);
      setAmountInput("");
      setReasonInput("");
      onRefresh?.();
    } catch (err: any) {
      setError(err?.message || "Ошибка записи корректировки");
    } finally {
      setLoading(false);
    }
  };

  const paymentEntries = entries.filter((e) => e.type === "PAYMENT");

  return (
    <div className="space-y-6">
      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">Всего начислено</CardDescription>
            <CardTitle className="text-2xl font-bold">{formatCents(summary.netCharges)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowDownRight className="w-3.5 h-3.5 text-blue-600" />
              <span>Базовые начисления: {formatCents(summary.totalCharges)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">Оплачено (нетто)</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600">
              {formatCents(summary.netPaid)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Возвраты: {formatCents(summary.totalRefunds)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">К оплате (долг)</CardDescription>
            <CardTitle className={`text-2xl font-bold ${summary.outstanding > 0 ? "text-amber-600" : "text-foreground"}`}>
              {formatCents(summary.outstanding)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {summary.outstanding > 0 ? "Есть неоплаченные визиты" : "Задолженность отсутствует"}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium">Депозит / Переплата</CardDescription>
            <CardTitle className={`text-2xl font-bold ${summary.credit > 0 ? "text-primary font-semibold" : "text-muted-foreground"}`}>
              {formatCents(summary.credit)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {summary.credit > 0 ? "Доступно для списания" : "Нет свободных средств"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Toolbar */}
      {canManageFinance && (
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            size="sm"
            onClick={() => {
              setAmountInput("");
              setReasonInput("Оплата услуги");
              setError(null);
              setPaymentOpen(true);
            }}
            className="flex items-center gap-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            Внести платёж / депозит
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAmountInput("");
              setReasonInput("");
              setTargetPaymentId("");
              setError(null);
              setRefundOpen(true);
            }}
            className="flex items-center gap-1.5"
            disabled={summary.netPaid <= 0}
          >
            <RotateCcw className="w-4 h-4" />
            Оформить возврат
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAmountInput("");
              setReasonInput("");
              setAdjustmentSign("credit");
              setError(null);
              setAdjustmentOpen(true);
            }}
            className="flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Корректировка
          </Button>
        </div>
      )}

      {/* Ledger History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Финансовый леджер (история операций)</CardTitle>
          <CardDescription>
            Неизменяемый журнал всех начислений, платежей, возвратов и корректировок
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Финансовых операций пока нет
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase border-b bg-muted/20">
                  <tr>
                    <th className="py-2.5 px-3">Дата</th>
                    <th className="py-2.5 px-3">Тип</th>
                    <th className="py-2.5 px-3">Назначение / Основание</th>
                    <th className="py-2.5 px-3">Способ</th>
                    <th className="py-2.5 px-3 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((entry) => {
                    const isPositiveCash = entry.type === "PAYMENT";
                    const isNegativeCash = entry.type === "REFUND";
                    const isCharge = entry.type === "CHARGE";
                    const isAdjustment = entry.type === "ADJUSTMENT";

                    let typeBadge = (
                      <Badge variant="outline" className="text-xs">
                        {entry.type}
                      </Badge>
                    );

                    if (isCharge) {
                      typeBadge = <Badge variant="secondary">Начисление</Badge>;
                    } else if (isPositiveCash) {
                      typeBadge = <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">Платёж</Badge>;
                    } else if (isNegativeCash) {
                      typeBadge = <Badge variant="destructive">Возврат</Badge>;
                    } else if (isAdjustment) {
                      typeBadge = <Badge variant="outline" className="border-amber-500 text-amber-700">Корректировка</Badge>;
                    }

                    return (
                      <tr key={entry.id} className="hover:bg-muted/10">
                        <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2.5 px-3">{typeBadge}</td>
                        <td className="py-2.5 px-3 font-medium">
                          {entry.reason}
                          {entry.targetPaymentId && (
                            <span className="block text-[11px] text-muted-foreground font-normal">
                              К платежу: #{entry.targetPaymentId.slice(0, 8)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-muted-foreground capitalize">
                          {entry.paymentMethod ?? "—"}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                          isPositiveCash
                            ? "text-emerald-600"
                            : isNegativeCash
                            ? "text-red-600"
                            : isAdjustment && entry.amountMinor < 0
                            ? "text-blue-600"
                            : ""
                        }`}>
                          {isNegativeCash || (isAdjustment && entry.amountMinor < 0) ? "−" : isPositiveCash ? "+" : ""}
                          {formatCents(Math.abs(entry.amountMinor))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Внести платёж / предоплату</DialogTitle>
            </DialogHeader>

            {error && (
              <div className="p-3 text-sm rounded bg-destructive/10 text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="pay-amount">Сумма (€)</Label>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="100.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-method">Способ оплаты</Label>
              <select
                id="pay-method"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={methodInput}
                onChange={(e) => setMethodInput(e.target.value as any)}
              >
                <option value="cash">Наличные</option>
                <option value="card">Банковская карта</option>
                <option value="bank_transfer">Банковский перевод</option>
                <option value="other">Другое</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-reason">Назначение платежа</Label>
              <Input
                id="pay-reason"
                required
                placeholder="Оплата услуги / Депозит"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Сохранение..." : "Записать платёж"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <form onSubmit={handleRecordRefund} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Оформить возврат</DialogTitle>
            </DialogHeader>

            {error && (
              <div className="p-3 text-sm rounded bg-destructive/10 text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            {paymentEntries.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="ref-target">Привязать к конкретному платежу (опционально)</Label>
                <select
                  id="ref-target"
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={targetPaymentId}
                  onChange={(e) => setTargetPaymentId(e.target.value)}
                >
                  <option value="">Общий возврат по счёту</option>
                  {paymentEntries.map((p) => (
                    <option key={p.id} value={p.id}>
                      {new Date(p.createdAt).toLocaleDateString("ru-RU")} — {formatCents(p.amountMinor)} ({p.reason})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ref-amount">Сумма возврата (€)</Label>
              <Input
                id="ref-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="50.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ref-reason">Причина возврата</Label>
              <Input
                id="ref-reason"
                required
                placeholder="Отказ от процедуры / частичный возврат"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRefundOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button type="submit" variant="destructive" disabled={loading}>
                {loading ? "Обработка..." : "Провести возврат"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adjustment Dialog */}
      <Dialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
        <DialogContent>
          <form onSubmit={handleRecordAdjustment} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Ручная финансовая корректировка</DialogTitle>
            </DialogHeader>

            {error && (
              <div className="p-3 text-sm rounded bg-destructive/10 text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Направление корректировки</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="adjSign"
                    value="credit"
                    checked={adjustmentSign === "credit"}
                    onChange={() => setAdjustmentSign("credit")}
                  />
                  Скидка / Уменьшение долга (−)
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="adjSign"
                    value="debit"
                    checked={adjustmentSign === "debit"}
                    onChange={() => setAdjustmentSign("debit")}
                  />
                  Дополнительное начисление (+)
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adj-amount">Сумма (€)</Label>
              <Input
                id="adj-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="20.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adj-reason">Обоснование корректировки</Label>
              <Input
                id="adj-reason"
                required
                placeholder="Согласованная скидка / компенсация"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustmentOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Сохранение..." : "Применить корректировку"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
