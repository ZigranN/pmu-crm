import { normalizePhone } from "./phone";

/**
 * Создает ссылку для WhatsApp
 */
export function createWhatsAppLink(phone: string, message?: string): string {
  const normalized = normalizePhone(phone);
  // Убираем + для ссылки
  const cleanPhone = normalized.replace("+", "");
  
  const url = new URL(`https://wa.me/${cleanPhone}`);
  
  if (message) {
    url.searchParams.set("text", message);
  }
  
  return url.toString();
}
