"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, Calendar, Shield, FileCheck, ArrowRight, Sparkles } from "lucide-react";
import type { PackageReadinessAggregate, CycleReadinessSummary } from "../domain/types";
import { completeTotalFacePackageAction } from "../server/actions";
import { ZONE_LABELS } from "@/features/treatment-cycles/stages";

interface TotalFacePackageCardProps {
  pkg: PackageReadinessAggregate;
  canManage: boolean;
}

export function TotalFacePackageCard({ pkg, canManage }: TotalFacePackageCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleComplete = () => {
    if (!pkg.canComplete) return;
    setError(null);
    startTransition(async () => {
      try {
        const reqKey = crypto.randomUUID();
        await completeTotalFacePackageAction(
          {
            packageId: pkg.packageId,
            reason: "Все дочерние циклы Total Face успешно завершены",
          },
          reqKey
        );
        router.refresh();
      } catch (err: any) {
        setError(err.message || "Ошибка при завершении пакета");
      }
    });
  };

  const getReadinessBadge = (status: PackageReadinessAggregate["overallReadiness"]) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Завершен</Badge>;
      case "READY":
        return <Badge className="bg-green-600 hover:bg-green-700 text-white gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Готов к процедурам</Badge>;
      case "PARTIALLY_READY":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1"><Clock className="h-3.5 w-3.5" /> Частично готов</Badge>;
      case "BLOCKED":
        return <Badge className="bg-destructive text-destructive-foreground gap-1"><XCircle className="h-3.5 w-3.5" /> Заблокирован</Badge>;
    }
  };

  const getCycleStatusBadge = (cycle: CycleReadinessSummary) => {
    switch (cycle.readiness) {
      case "COMPLETED":
        return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Завершен</Badge>;
      case "BLOCKED":
        return <Badge variant="destructive">Мед. блок</Badge>;
      case "READY":
        return <Badge className="bg-green-600 text-white">Готов</Badge>;
      case "PARTIALLY_READY":
        return <Badge variant="outline" className="text-amber-600 border-amber-300">В процессе</Badge>;
    }
  };

  return (
    <Card className="border-2 border-primary/20 shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Пакет Total Face</CardTitle>
              {getReadinessBadge(pkg.overallReadiness)}
            </div>
            <CardDescription>
              Объединяет {pkg.totalCyclesCount} независимых зон в комплексный протокол
            </CardDescription>
          </div>

          <div className="text-sm sm:text-right">
            <div className="text-muted-foreground">Финансы пакета</div>
            <div className="font-semibold text-base">
              {(pkg.financialSummary.paidCents / 100).toLocaleString("ru-RU")} / {(pkg.financialSummary.expectedTotalCents / 100).toLocaleString("ru-RU")} ₽
            </div>
            {pkg.financialSummary.outstandingCents > 0 && (
              <div className="text-xs text-amber-600">
                Остаток: {(pkg.financialSummary.outstandingCents / 100).toLocaleString("ru-RU")} ₽
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {pkg.cycles.map((cycle) => (
            <div
              key={cycle.cycleId}
              className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm flex flex-col justify-between space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base">
                    {ZONE_LABELS[cycle.zoneCode] ?? cycle.zoneCode}
                  </span>
                  {getCycleStatusBadge(cycle)}
                </div>

                <div className="text-xs text-muted-foreground">
                  Этап: <span className="font-medium text-foreground">{cycle.stageTitle ?? cycle.stage}</span>
                </div>

                <div className="space-y-1.5 pt-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Мед. допуск: </span>
                    {cycle.medicalStatus === "CLEARED" ? (
                      <span className="text-emerald-600 font-medium">Допущен</span>
                    ) : cycle.medicalStatus === "NOT_CLEARED" ? (
                      <span className="text-destructive font-medium">Противопоказания</span>
                    ) : (
                      <span className="text-amber-600 font-medium">Требует оценки</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <FileCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Согласие: </span>
                    {cycle.consentStatus === "COVERED" ? (
                      <span className="text-emerald-600 font-medium">Подписано</span>
                    ) : (
                      <span className="text-amber-600 font-medium">Не подписано</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Запись: </span>
                    {cycle.nextAppointment ? (
                      <span className="font-medium">
                        {format(new Date(cycle.nextAppointment.startAt), "dd.MM HH:mm", { locale: ru })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Нет записи</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  Оплачено: {(cycle.financial.paidCents / 100).toLocaleString("ru-RU")} ₽
                </div>
                <Button asChild variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1">
                  <Link href={`/deals/${cycle.cycleId}`}>
                    Открыть <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <CardFooter className="bg-muted/10 border-t flex items-center justify-between py-3">
        <div className="text-xs text-muted-foreground">
          Завершено зон: {pkg.completedCyclesCount} из {pkg.totalCyclesCount}
        </div>

        {pkg.status === "active" && (
          <Button
            size="sm"
            variant={pkg.canComplete ? "default" : "outline"}
            disabled={!pkg.canComplete || isPending || !canManage}
            onClick={handleComplete}
          >
            {isPending ? "Завершение..." : "Завершить пакет"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
