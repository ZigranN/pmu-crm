import { createHash } from "node:crypto";
import type { LegacySourceDataset } from "../types";

export function computeSourceChecksum(content: string | Buffer | object): string {
  const hash = createHash("sha256");
  if (typeof content === "string" || Buffer.isBuffer(content)) {
    hash.update(content);
  } else {
    // Deterministic object serialization
    hash.update(JSON.stringify(content, Object.keys(content).sort()));
  }
  return hash.digest("hex");
}

export function redactSensitivePii(text: string | null | undefined): string {
  if (!text) return "";
  // Redact emails
  let sanitized = text.replace(/([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g, (_, user, domain) => {
    return `${user.slice(0, 2)}***@${domain}`;
  });
  // Redact phone numbers (digits sequence >= 7)
  sanitized = sanitized.replace(/(\+?\d{1,3})?[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g, (match) => {
    return `${match.slice(0, 4)}***${match.slice(-2)}`;
  });
  return sanitized;
}

export function parseSourceDataset(raw: string | object): {
  dataset: LegacySourceDataset;
  checksum: string;
} {
  let parsed: unknown;
  let rawStr = "";
  if (typeof raw === "string") {
    rawStr = raw;
    parsed = JSON.parse(raw);
  } else {
    parsed = raw;
    rawStr = JSON.stringify(raw);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid migration source: expected root object");
  }

  const obj = parsed as Record<string, unknown>;
  const dataset: LegacySourceDataset = {
    sourceSystem: typeof obj.sourceSystem === "string" ? obj.sourceSystem : "legacy_crm",
    extractedAt: typeof obj.extractedAt === "string" ? obj.extractedAt : new Date().toISOString(),
    clients: Array.isArray(obj.clients) ? (obj.clients as any[]) : [],
    staff: Array.isArray(obj.staff) ? (obj.staff as any[]) : [],
    services: Array.isArray(obj.services) ? (obj.services as any[]) : [],
    appointments: Array.isArray(obj.appointments) ? (obj.appointments as any[]) : [],
    cycles: Array.isArray(obj.cycles) ? (obj.cycles as any[]) : [],
    medicalProfiles: Array.isArray(obj.medicalProfiles) ? (obj.medicalProfiles as any[]) : [],
    medicalClearances: Array.isArray(obj.medicalClearances) ? (obj.medicalClearances as any[]) : [],
    consents: Array.isArray(obj.consents) ? (obj.consents as any[]) : [],
    procedures: Array.isArray(obj.procedures) ? (obj.procedures as any[]) : [],
    finances: Array.isArray(obj.finances) ? (obj.finances as any[]) : [],
    conversations: Array.isArray(obj.conversations) ? (obj.conversations as any[]) : [],
    messages: Array.isArray(obj.messages) ? (obj.messages as any[]) : [],
    media: Array.isArray(obj.media) ? (obj.media as any[]) : [],
    packages: Array.isArray(obj.packages) ? (obj.packages as any[]) : [],
  };

  const checksum = computeSourceChecksum(rawStr);
  return { dataset, checksum };
}
