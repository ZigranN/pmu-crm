/**
 * Приводит телефон к формату +79991234567 или +393331234567
 */
export function normalizePhone(phone: string): string {
  // Убираем все кроме цифр
  const cleaned = phone.replace(/\D/g, "");
  
  // Если пусто
  if (!cleaned) return "";

  // Если начинается с 8 и длина 11 (РФ)
  if (cleaned.length === 11 && cleaned.startsWith("8")) {
    return `+7${cleaned.slice(1)}`;
  }

  // Если начинается не с +
  if (!phone.startsWith("+")) {
    // В зависимости от длины можно догадываться о коде страны, 
    // но лучше просто добавлять +, если его нет
    return `+${cleaned}`;
  }

  return `+${cleaned}`;
}

/**
 * Красиво форматирует телефон для отображения
 */
export function formatPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";

  // Пример для РФ: +7 999 123-45-67
  if (normalized.startsWith("+7") && normalized.length === 12) {
    return `${normalized.slice(0, 2)} ${normalized.slice(2, 5)} ${normalized.slice(5, 8)}-${normalized.slice(8, 10)}-${normalized.slice(10, 12)}`;
  }

  // Пример для Италии: +39 333 123 4567
  if (normalized.startsWith("+39")) {
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`;
  }

  return normalized;
}
