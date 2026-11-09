"use client";

import React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eraser, ArrowRight } from "lucide-react";
import { CreateRemoverDialog } from "./create-remover-dialog";
import { ZONE_LABELS, STAGE_LABELS, type CycleStage } from "@/features/treatment-cycles/stages";

interface RemoverCyclesSectionProps {
  clientId: string;
  removerCycles: Array<{
    id: string;
    zoneCode: string;
    stage: string;
    originCycleId?: string | null;
    updatedAt: Date;
  }>;
  existingPmuCycles: Array<{ id: string; zoneCode: string; stage: string }>;
  canManage: boolean;
}

export function RemoverCyclesSection({
  clientId,
  removerCycles,
  existingPmuCycles,
  canManage,
}: RemoverCyclesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Удаление пигмента (Remover)</h3>
          <p className="text-sm text-muted-foreground">
            Специализированные протоколы удаления с сохранением полного мед. допуска и согласий
          </p>
        </div>
        {canManage && (
          <CreateRemoverDialog
            clientId={clientId}
            existingCycles={existingPmuCycles}
          />
        )}
      </div>

      {removerCycles.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Eraser className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
          <h4 className="text-sm font-semibold">Нет активных циклов удаления</h4>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
            Процедуры удаления старого или некачественного пигмента ведутся в отдельном цикле с фиксацией истории ��ессий.
          </p>
          {canManage && (
            <CreateRemoverDialog
              clientId={clientId}
              existingCycles={existingPmuCycles}
            />
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {removerCycles.map((cycle) => (
            <Card key={cycle.id} className="border border-amber-200 dark:border-amber-900/50 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eraser className="h-4 w-4 text-amber-600" />
                    <CardTitle className="text-base">
                      {ZONE_LABELS[cycle.zoneCode] ?? cycle.zoneCode}
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300">
                    {STAGE_LABELS[cycle.stage as CycleStage] ?? cycle.stage}
                  </Badge>
                </div>
                {cycle.originCycleId && (
                  <CardDescription className="text-xs">
                    Исходный цикл: {cycle.originCycleId.slice(0, 8)}...
                  </CardDescription>
                )}
              </CardHeader>

              <CardContent className="pt-0 space-y-3">
                <div className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>Обновлен:</span>
                  <span>{format(new Date(cycle.updatedAt), "dd.MM.yyyy HH:mm", { locale: ru })}</span>
                </div>

                <div className="pt-2 border-t flex justify-end">
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
                    <Link href={`/deals/${cycle.id}`}>
                      Открыть таймлайн <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
