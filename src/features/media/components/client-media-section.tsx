"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/features/media/components/image-upload";
import { getClientMediaAction, deleteMediaAction } from "@/features/media/server/actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ClientMediaSectionProps {
  clientId: string;
  initialType?: string;
}

const MEDIA_TYPES = [
  { value: "before", label: "До" },
  { value: "after", label: "После" },
  { value: "healing_day_7", label: "Заживление (7 день)" },
  { value: "healing_day_30", label: "Заживление (30 день)" },
  { value: "correction", label: "Коррекция" },
  { value: "refresh", label: "Рефреш" },
  { value: "consent", label: "Согласие" },
  { value: "document", label: "Документ" },
  { value: "other", label: "Другое" },
];

export function ClientMediaSection({ clientId, initialType = "other" }: ClientMediaSectionProps) {
  const [media, setMedia] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadType, setUploadType] = useState(initialType);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMedia() {
      try {
        setIsLoading(true);
        const data = await getClientMediaAction(clientId);
        
        if (!cancelled) {
          const filteredData = initialType === "other" 
            ? data.filter((m: any) => m.type !== "consent")
            : data.filter((m: any) => m.type === initialType);
          setMedia(filteredData);
        }
      } catch {
        if (!cancelled) {
          console.error("Failed to fetch media");
          setError("Не удалось загрузить медиафайлы");
          toast.error("Не удалось загрузить медиафайлы");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadMedia();

    return () => {
      cancelled = true;
    };
  }, [clientId, initialType]);

  const handleDelete = async (id: string) => {
    if (!confirm("Вы уверены, что хотите удалить этот файл?")) return;
    
    try {
      await deleteMediaAction(id);
      toast.success("Файл удален");
      setMedia(media.filter((m) => m.id !== id));
    } catch {
      toast.error("Ошибка при удалении");
    }
  };

  const onUploadSuccess = async () => {
    try {
      setIsLoading(true);
      const data = await getClientMediaAction(clientId);
      const filteredData = initialType === "other" 
        ? data.filter((m: any) => m.type !== "consent")
        : data.filter((m: any) => m.type === initialType);
      setMedia(filteredData);
    } catch {
      console.error("Failed to refresh media");
      toast.error("Ошибка при обновлении списка");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Добавить фото или документ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="w-full sm:w-64 space-y-2">
                <label className="text-sm font-medium">Тип файла</label>
                <Select value={uploadType} onValueChange={setUploadType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEDIA_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 w-full">
                 <ImageUpload 
                  mode="media" 
                  clientId={clientId} 
                  type={uploadType}
                  onChange={onUploadSuccess}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-taupe" />
        </div>
      ) : media.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {media.map((item) => (
            <Card key={item.id} className="overflow-hidden group">
              <div className="relative aspect-square">
                <Image
                  src={item.url}
                  alt={item.type}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="absolute bottom-2 left-2">
                  <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded uppercase tracking-wider">
                    {MEDIA_TYPES.find(t => t.value === item.type)?.label || item.type}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ImageIcon}
          title="Медиафайлов нет"
          description="Загрузите первые фото или документы клиента"
        />
      )}
    </div>
  );
}
