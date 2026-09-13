import { canonicalPhone } from "@/lib/phone";
export { canonicalPhone };
export function canonicalEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
export function canonicalInstagram(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").replace(/\/$/, "");
  return normalized && /^[a-z0-9_][a-z0-9_.]{0,29}$/.test(normalized) && !normalized.endsWith(".") && !normalized.includes("..") ? normalized : null;
}
export const canonicalName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export function similarName(a: string, b: string) {
  if (a === b) return a.length >= 3;
  if (a.length < 5 || b.length < 5 || a.slice(0, 3) !== b.slice(0, 3) || Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[b.length] <= (Math.min(a.length, b.length) >= 10 ? 2 : 1);
}
