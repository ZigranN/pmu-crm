import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/encryption";

describe("Encryption facility", () => {
  it("encrypts and decrypts secrets correctly", () => {
    const secret = "ya29.a0AfH6SMB_secret_access_token_12345";
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toBe(secret);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it("handles empty strings", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("uses random IV so subsequent encryptions produce different ciphertexts", () => {
    const secret = "refresh_token_xyz_987";
    const enc1 = encryptSecret(secret);
    const enc2 = encryptSecret(secret);

    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1)).toBe(secret);
    expect(decryptSecret(enc2)).toBe(secret);
  });

  it("fails when payload is tampered", () => {
    const secret = "super_sensitive_token";
    const encrypted = encryptSecret(secret);
    const parts = encrypted.split(":");
    // Tamper with ciphertext deterministically
    const flipped = parts[4].endsWith("0") ? "1" : "0";
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${parts[4].slice(0, -1)}${flipped}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("supports custom keys", () => {
    const customKey = "custom-key-for-test-32bytes-long!";
    const secret = "google_refresh_token_abc";
    const encrypted = encryptSecret(secret, customKey);

    expect(decryptSecret(encrypted, customKey)).toBe(secret);
    expect(() => decryptSecret(encrypted, "wrong-key")).toThrow();
  });
});
