"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eraser } from "lucide-react";
import { createRemoverCycleAction } from "@/features/treatment-cycles/server/actions";
import { ZONE_LABELS } from "@/features/treatment-cycles/stages";

interface CreateRemoverDialogProps {
  clientId: string;
  existingCycles?: Array<{ id: string; zoneCode: string; stage: string }>;
}

const REMOVER_ZONES = [
  { code: "brows", label: "Брови" },
  { code: "eyes", label: "Глаза (веки)" },
  { code: "lips", label: "Губы" },
  { code: "skin", label: "Кожа / Лицо" },
  { code: "lashes", label: "Ресницы" },
] as const;

export function CreateRemoverDialog({ clientId, existingCycles = [] }: CreateRemoverDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zoneCode, setZoneCode] = useState<"brows" | "eyes" | "lips" | "skin" | "lashes">("brows");
  const [originCycleId, setOriginCycleId] = useState<string>("none");
  const [reason, setReason] = useState("Инициализация цикла удаления некачественного/старого ПМ");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError("Укажите причину (минимум 3 символа)");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const reqKey = crypto.randomUUID();
        await createRemoverCycleAction(
          {
            clientId,
            zoneCode,
            originCycleId: originCycleId !== "none" ? originCycleId : undefined,
            reason: reason.trim(),
          },
          reqKey
        );
        setOpen(false);
        router.refresh();
      } catch (err: any) {
        setError(err.message || "Ошибка создания цикла удаления");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Eraser className="h-4 w-4 text-amber-600" />
          <span>Начать удаление (Remover)</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eraser className="h-5 w-5 text-amber-600" />
              Новый цикл удаления (Remover)
            </DialogTitle>
            <DialogDescription>
              Создает специализированный цикл удаления пигмента (ремувер/лазер) с соблюдением мед. допуска и согласий.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="zone" className="text-sm font-medium">
                Обрабатываемая зона
              </Label>
              <Select
                value={zoneCode}
                onValueChange={(val: any) => setZoneCode(val)}
              >
                <SelectTrigger id="zone">
                  <SelectValue placeholder="Выберите зону" />
                </SelectTrigger>
                <SelectContent>
                  {REMOVER_ZONES.map((z) => (
                    <SelectItem key={z.code} value={z.code}>
                      {z.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {existingCycles.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="originCycle" className="text-sm font-medium">
                  Связанный исходный цикл ПМ (опционально)
                </Label>
                <Select
                  value={originCycleId}
                  onValueChange={(val) => setOriginCycleId(val)}
                >
                  <SelectTrigger id="originCycle">
                    <SelectValue placeholder="Без привязки к циклу" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без привязки к циклу</SelectItem>
                    {existingCycles.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {ZONE_LABELS[c.zoneCode] ?? c.zoneCode} ({c.stage})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reason" className="text-sm font-medium">
                Обоснование / Причина создания
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Укажите причину создания цикла удаления..."
                rows={3}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Создание..." : "Создать цикл"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
