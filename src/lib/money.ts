/**
 * Форматирует центы в строку с валютой €
 * @param cents Сумма в центах
 * @returns Строка вида €550 или €1.250
 */
export function formatCents(cents: number): string {
  const euros = cents / 100;
  
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(euros);
}

/**
 * Парсит строку (например "550" или "550.50") в центы
 */
export function parseEuroToCents(value: string | number): number {
  if (typeof value === "number") return Math.round(value * 100);
  
  const cleaned = value.replace(",", ".");
  const parsed = parseFloat(cleaned);
  
  if (isNaN(parsed)) return 0;
  
  return Math.round(parsed * 100);
}
