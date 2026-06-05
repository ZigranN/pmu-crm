"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2 } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
  disabled?: boolean;
  maxSizeMB?: number;
  mode?: "generic" | "media"; // generic = simple upload (master/studio), media = requires clientId
  clientId?: string; // only for media mode
  type?: string; // for media mode
}

export function ImageUpload({
  value,
  onChange,
  onRemove,
  disabled = false,
  maxSizeMB = 5,
  mode = "generic",
  clientId,
  type = "other",
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(`Файл слишком большой. Максимум ${maxSizeMB}MB`);
      return;
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Пожалуйста, выберите изображение");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      let endpoint = "/api/upload/image"; // default generic upload

      if (mode === "media") {
        if (!clientId) {
          throw new Error("Client ID required for media upload");
        }
        endpoint = "/api/media/upload";
        formData.append("clientId", clientId);
        formData.append("type", type);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Upload failed");
      }

      const data = await response.json();
      onChange(data.url);
      toast.success("Фото загружено");
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Ошибка при загрузке фото");
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-4">
      {value ? (
        <div className="relative w-full h-48 rounded-lg overflow-hidden border border-borderSoft">
          <Image
            src={value}
            alt="Uploaded image"
            fill
            className="object-cover"
          />
          {!disabled && onRemove && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2"
              onClick={onRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="border-2 border-dashed border-borderSoft rounded-lg p-6 text-center">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={disabled || isUploading}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Загрузка...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Выбрать фото
              </>
            )}
          </Button>
          <p className="text-sm text-textMuted mt-2">
            Макс. размер: {maxSizeMB}MB
          </p>
        </div>
      )}
    </div>
  );
}
