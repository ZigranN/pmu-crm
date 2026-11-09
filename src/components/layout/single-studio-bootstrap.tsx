"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setActiveStudioAction } from "@/features/auth/server/actions";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import type { UserActiveStudio } from "@/server/auth/context";

export function SingleStudioBootstrap({ studio }: { studio: UserActiveStudio }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(true);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    setActiveStudioAction(studio.studioId)
      .then((res) => {
        if (res.success) {
          router.refresh();
        } else {
          setError("Не удалось автоматически установить контекст студии.");
          setIsPending(false);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Не удалось установить студию.");
        setIsPending(false);
      });
  }, [studio.studioId, router]);

  const handleRetry = () => {
    setIsPending(true);
    setError(null);
    setActiveStudioAction(studio.studioId)
      .then((res) => {
        if (res.success) {
          router.refresh();
        } else {
          setError("Не удалось автоматически установить контекст студии.");
          setIsPending(false);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Не удалось установить студию.");
        setIsPending(false);
      });
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-2xl border border-borderSoft shadow-xs text-center">
      {isPending && !error ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-taupe" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-taupe">Подключение к студии</h2>
            <p className="text-sm text-muted">
              Устанавливаем рабочее пространство «{studio.studioName}»...
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center space-y-4">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-taupe">Ошибка подключения</h2>
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <Button onClick={handleRetry} className="mt-2">
            Повторить попытку
          </Button>
        </div>
      ) : null}
    </div>
  );
}
