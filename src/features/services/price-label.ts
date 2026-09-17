import { formatCents } from "@/lib/money";
export function servicePriceLabel(service: { priceMode: string; priceCents: number | null; priceMaxCents: number | null; catalogCode?: string | null }) {
  if (service.priceMode === "legacy") return "Цена требует проверки";
  if (service.priceMode === "master_quote" || service.priceCents === null) return "Цена определяется мастером";
  const value = formatCents(service.priceCents);
  const suffix = service.catalogCode === "remover" ? " за сеанс" : "";
  if (service.priceMode === "estimate") return `Ориентир ${value}${suffix}`;
  if (service.priceMode === "range") return service.priceMaxCents === null ? "Цена требует проверки" : `Ориентир ${value}–${formatCents(service.priceMaxCents)}${suffix}`;
  return `Базовая цена ${value}${suffix}`;
}
