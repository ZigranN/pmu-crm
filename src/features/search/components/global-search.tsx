"use client";

import React, { useState, useEffect } from "react";
import { Search, Users, Scissors, User, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { globalSearchAction } from "../server/actions";
import { useDebounce } from "@/hooks/use-debounce";

interface GlobalSearchProps {
  studioId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ studioId, open, onOpenChange }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    clients: any[];
    services: any[];
    masters: any[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    let active = true;
    async function search() {
      setError(null);
      if (!open || query.trim().length < 2 || query !== debouncedQuery) {
        setResults(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const data = await globalSearchAction(studioId, debouncedQuery.trim());
        if (active) setResults(data);
      } catch {
        if (active) { setResults(null); setError("Не удалось выполнить поиск. Попробуйте ещё раз."); }
      } finally { if (active) setIsLoading(false); }
    }
    void search();
    return () => { active = false; };
  }, [query, debouncedQuery, studioId, open]);

  const navigateTo = (path: string) => {
    onOpenChange(false);
    setQuery("");
    setResults(null);
    router.push(path);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Поиск по студии</DialogTitle>
        <DialogDescription className="sr-only">Найдите клиента, услугу или мастера.</DialogDescription>
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            aria-label="Поисковый запрос"
            placeholder="Поиск клиентов, услуг или мастеров..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setResults(null); }}
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none border-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin opacity-50" />}
          {query && !isLoading && (
            <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="p-2 mr-6">
              <X className="h-4 w-4 opacity-50" />
            </button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {error && <p role="alert" className="p-4 text-sm">{error}</p>}
          {!results && !isLoading && query.length < 2 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Введите минимум 2 символа для поиска...
            </p>
          )}

          {results && (
            <div className="space-y-4">
              {results.clients.length > 0 && (
                <div>
                  <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Клиенты
                  </h3>
                  <div className="space-y-1">
                    {results.clients.map((client) => (
                      <button
                        key={client.id}
                        onClick={() => navigateTo(`/clients/${client.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sand/50 text-left transition-colors"
                      >
                        <Users className="h-4 w-4 text-taupe" />
                        <div>
                          <p className="font-medium">{client.fullName}</p>
                          <p className="text-xs text-muted-foreground">{client.phone}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.services.length > 0 && (
                <div>
                  <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Услуги
                  </h3>
                  <div className="space-y-1">
                    {results.services.map((service) => (
                      <button
                        key={service.id}
                        onClick={() => navigateTo(`/services/${service.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sand/50 text-left transition-colors"
                      >
                        <Scissors className="h-4 w-4 text-taupe" />
                        <div>
                          <p className="font-medium">{service.name}</p>
                          <p className="text-xs text-muted-foreground">{service.category}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.masters.length > 0 && (
                <div>
                  <h3 className="px-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Мастера
                  </h3>
                  <div className="space-y-1">
                    {results.masters.map((master) => (
                      <button
                        key={master.id}
                        onClick={() => navigateTo(`/masters/${master.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sand/50 text-left transition-colors"
                      >
                        <User className="h-4 w-4 text-taupe" />
                        <div>
                          <p className="font-medium">{master.displayName}</p>
                          <p className="text-xs text-muted-foreground">{master.phone || master.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.clients.length === 0 && results.services.length === 0 && results.masters.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Ничего не найдено.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
