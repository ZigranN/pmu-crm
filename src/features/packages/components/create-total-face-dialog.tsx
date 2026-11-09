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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { createTotalFacePackageAction } from "../server/actions";
import { TOTAL_FACE_SUPPORTED_ZONES, type TotalFaceZoneCode } from "../domain/types";
import { ZONE_LABELS } from "@/features/treatment-cycles/stages";

interface CreateTotalFaceDialogProps {
  clientId: string;
}

export function CreateTotalFaceDialog({ clientId }: CreateTotalFaceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedZones, setSelectedZones] = useState<TotalFaceZoneCode[]>([
    "brows",
    "eyes",
    "lips",
  ]);
  const [reason, setReason] = useState("Инициализация комплексного пакета Total Face");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleZone = (zone: TotalFaceZoneCode) => {
    if (selectedZones.includes(zone)) {
      if (selectedZones.length === 1) return; // Keep at least one
      setSelectedZones(selectedZones.filter((z) => z !== zone));
    } else {
      setSelectedZones([...selectedZones, zone]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedZones.length === 0) {
      setError("Выберите хотя бы одну зону");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Укажите причину (минимум 3 символа)");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const reqKey = crypto.randomUUID();
        await createTotalFacePackageAction(
          {
            clientId,
            zoneCodes: selectedZones,
            reason: reason.trim(),
          },
          reqKey
        );
        setOpen(false);
        router.refresh();
      } catch (err: any) {
        setError(err.message || "Ошибка создания пакета");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Создать Total Face</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Создание пакета Total Face
            </DialogTitle>
            <DialogDescription>
              Создает группирующий пакет и независимые циклы для каждой выбранной зоны лица.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium">Включенные зоны</Label>
              <div className="grid grid-cols-3 gap-3">
                {TOTAL_FACE_SUPPORTED_ZONES.map((zone) => {
                  const isChecked = selectedZones.includes(zone);
                  return (
                    <div
                      key={zone}
                      onClick={() => toggleZone(zone)}
                      className={`flex items-center space-x-2 border rounded-md p-3 cursor-pointer transition-colors ${
                        isChecked
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-muted hover:bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleZone(zone)}
                        id={`zone-${zone}`}
                      />
                      <label
                        htmlFor={`zone-${zone}`}
                        className="text-sm cursor-pointer select-none"
                      >
                        {ZONE_LABELS[zone] ?? zone}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason" className="text-sm font-medium">
                Обоснование / Примечание
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Укажите причину создания пакета..."
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
            <Button type="submit" disabled={isPending || selectedZones.length === 0}>
              {isPending ? "Создание..." : "Создать пакет"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
