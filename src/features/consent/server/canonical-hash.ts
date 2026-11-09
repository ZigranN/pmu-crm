import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export interface CanonicalTemplateContent {
  title: string;
  body: string;
}

/**
 * Computes a deterministic canonical SHA-256 hash for consent template content.
 * Uses unambiguous canonical JSON encoding of { title, body } to guarantee:
 * - Deterministic serialization (sorted keys, standard JSON string escapes).
 * - Prevention of boundary collision vulnerabilities present in simple string concatenation.
 * - 64-character lowercase hexadecimal output.
 */
export function computeCanonicalTemplateHash(content: CanonicalTemplateContent): string {
  const normalizedTitle = content.title.trim();
  const normalizedBody = content.body.trim();

  const canonicalPayload = canonicalJson({
    body: normalizedBody,
    title: normalizedTitle,
  });

  return createHash("sha256").update(canonicalPayload).digest("hex");
}
