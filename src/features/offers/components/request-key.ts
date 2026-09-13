"use client";
// Persist only a fingerprint/key, never the financial payload or client details.
export async function requestKey(storageKey: string, payload: unknown) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  const saved = sessionStorage.getItem(storageKey);
  if (saved) { try { const entry = JSON.parse(saved); if (entry.hash === hash && typeof entry.key === "string") return entry.key as string; } catch { /* Replace corrupt local state. */ } }
  const key = crypto.randomUUID(); sessionStorage.setItem(storageKey, JSON.stringify({ hash, key })); return key;
}
export const euro = (cents: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
export function parseEuro(value: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("Введите сумму с точностью до цента");
  const result = Math.round(Number(value.replace(",", ".")) * 100);
  if (!Number.isSafeInteger(result) || result > 2147483647) throw new Error("Сумма слишком велика");
  return result;
}
