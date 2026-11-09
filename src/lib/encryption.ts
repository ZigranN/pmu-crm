import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const PREFIX = "enc:v1";

function resolveKey(customKey?: string): Buffer {
  const secret =
    customKey ||
    process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    "pmu-crm-fallback-default-encryption-secret-key-32b";

  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext string into a tamper-proof AES-256-GCM token.
 * Format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(plaintext: string, customKey?: string): string {
  if (!plaintext) {
    return "";
  }

  const key = resolveKey(customKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return `${PREFIX}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM token back to plaintext.
 * Throws an error if payload is corrupted or tampered with.
 */
export function decryptSecret(encryptedPayload: string, customKey?: string): string {
  if (!encryptedPayload) {
    return "";
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Invalid encrypted payload format");
  }

  const ivHex = parts[2];
  const tagHex = parts[3];
  const cipherHex = parts[4];

  const key = resolveKey(customKey);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
