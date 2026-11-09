"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setActiveStudioAction } from "@/features/auth/server/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Loader2, AlertTriangle } from "lucide-react";
import type { UserActiveStudio } from "@/server/auth/context";

export function StudioSelector({
  activeStudios,
  isStale = false,
}: {
  activeStudios: UserActiveStudio[];
  isStale?: boolean;
}) {
  const router = useRouter();
  const [selectedStudioId, setSelectedStudioId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (studioId: string) => {
    if (isPending) return;
    setSelectedStudioId(studioId);
    setIsPending(true);
    setError(null);

    try {
      const res = await setActiveStudioAction(studioId);
      if (res.success) {
        router.refresh();
      } else {
        setError("Не удалось выбрать студию. Пожалуйста, попробуйте еще раз.");
        setIsPending(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выбрать студию.");
      setIsPending(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-12 p-6 sm:p-8 bg-white rounded-2xl border border-borderSoft shadow-xs">
      <div className="text-center mb-6 space-y-2">
        <div className="w-12 h-12 bg-ivory rounded-full flex items-center justify-center mx-auto text-taupe mb-2">
          <Building2 className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-taupe">Выбор активной студии</h1>
        <p className="text-sm text-muted">
          Выберите рабочее пространство для продолжения работы
        </p>
      </div>

      {isStale && (
        <div
          role="alert"
          className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2.5"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <span>Предыдущая сессия студии устарела. Пожалуйста, выберите активную студию.</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm"
        >
          {error}
        </div>
      )}

      <div className="space-y-3">
        {activeStudios.map((studio) => {
          const isSelected = selectedStudioId === studio.studioId;
          return (
            <button
              key={studio.studioId}
              type="button"
              disabled={isPending}
              onClick={() => handleSelect(studio.studioId)}
              className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
                isSelected
                  ? "border-taupe bg-ivory/50 ring-1 ring-taupe"
                  : "border-borderSoft hover:border-taupe/50 hover:bg-ivory/20"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <div className="space-y-1">
                <div className="font-semibold text-taupe text-base flex items-center gap-2">
                  {studio.studioName}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    Роль: {studio.role}
                  </Badge>
                </div>
              </div>
              <div className="shrink-0">
                {isSelected && isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin text-taupe" />
                ) : (
                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    disabled={isPending}
                    tabIndex={-1}
                  >
                    Выбрать
                  </Button>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
