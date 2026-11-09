import { describe, expect, it } from "vitest";
import { computeCanonicalTemplateHash } from "@/features/consent/server/canonical-hash";

describe("computeCanonicalTemplateHash", () => {
  it("computes a deterministic 64-character lowercase hex SHA-256 hash", () => {
    const hash = computeCanonicalTemplateHash({
      title: "PMU Standard Consent",
      body: "I hereby agree to the permanent makeup procedure.",
    });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toHaveLength(64);
  });

  it("produces identical hashes for identical content across multiple runs", () => {
    const input = {
      title: "Brows Procedure Consent",
      body: "Detailed clinical agreement and instructions.",
    };

    const hash1 = computeCanonicalTemplateHash(input);
    const hash2 = computeCanonicalTemplateHash(input);
    const hash3 = computeCanonicalTemplateHash({ ...input });

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("normalizes leading and trailing whitespace in title and body", () => {
    const hash1 = computeCanonicalTemplateHash({
      title: "  Lips Shading Consent  ",
      body: "  Terms and conditions.  ",
    });

    const hash2 = computeCanonicalTemplateHash({
      title: "Lips Shading Consent",
      body: "Terms and conditions.",
    });

    expect(hash1).toBe(hash2);
  });

  it("does not suffer from string concatenation boundary collisions", () => {
    // If concatenation were `title + body`:
    // "AB" + "CD" === "A" + "BCD" ("ABCD")
    // Canonical JSON ensures `{"body":"CD","title":"AB"}` !== `{"body":"BCD","title":"A"}`
    const hash1 = computeCanonicalTemplateHash({
      title: "AB",
      body: "CD",
    });

    const hash2 = computeCanonicalTemplateHash({
      title: "A",
      body: "BCD",
    });

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes when content differs", () => {
    const hash1 = computeCanonicalTemplateHash({
      title: "Consent V1",
      body: "Body A",
    });

    const hash2 = computeCanonicalTemplateHash({
      title: "Consent V1",
      body: "Body B",
    });

    const hash3 = computeCanonicalTemplateHash({
      title: "Consent V2",
      body: "Body A",
    });

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });
});
