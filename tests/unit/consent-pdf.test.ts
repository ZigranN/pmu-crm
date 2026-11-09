import { describe, expect, it } from "vitest";
import {
  generateConsentPdf,
  computePdfSha256,
  type ConsentPdfData,
} from "@/features/consent/server/pdf";
import { validateFile, FILE_SIZE_LIMITS, ALLOWED_FORMATS } from "@/lib/file-validation";

/**
 * Extracts rendered Unicode text from generated PDF streams using the embedded /ToUnicode CMap.
 */
function extractPdfText(pdfBuffer: Buffer): string {
  const pdfString = pdfBuffer.toString("latin1");

  // Parse all ToUnicode CMap beginbfchar ... endbfchar blocks
  const bfcharBlocks = [...pdfString.matchAll(/\d+\s+beginbfchar\s*([\s\S]*?)\s*endbfchar/g)];
  const gidToChar = new Map<string, string>();

  for (const match of bfcharBlocks) {
    const blockContent = match[1];
    const lines = blockContent.trim().split("\n");
    for (const line of lines) {
      const m = line.trim().match(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>/);
      if (m) {
        const gid = m[1].toUpperCase();
        const code = parseInt(m[2], 16);
        gidToChar.set(gid, String.fromCharCode(code));
      }
    }
  }

  // Extract and decode all text operations from content streams
  const streamMatches = [...pdfString.matchAll(/<<\s*\/Length\s+\d+\s*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  const decodedLines: string[] = [];

  for (const sm of streamMatches) {
    const content = sm[1];
    const hexMatches = [...content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)];
    for (const hm of hexMatches) {
      const hexStr = hm[1];
      const chars: string[] = [];
      for (let i = 0; i < hexStr.length; i += 4) {
        const gid = hexStr.substring(i, i + 4).toUpperCase();
        chars.push(gidToChar.get(gid) ?? "?");
      }
      decodedLines.push(chars.join(""));
    }
  }

  return decodedLines.join("\n");
}

describe("Consent PDF Generator", () => {
  const sampleData: ConsentPdfData = {
    studioId: "11111111-1111-1111-1111-111111111111",
    studioName: "Studio Luxe PMU",
    clientId: "22222222-2222-2222-2222-222222222222",
    clientName: "Jane Doe",
    signatoryName: "Jane Doe",
    signatoryRole: "client",
    cycleId: "33333333-3333-3333-3333-333333333333",
    zoneCode: "brows",
    templateId: "44444444-4444-4444-4444-444444444444",
    templateVersionId: "55555555-5555-5555-5555-555555555555",
    versionNumber: 1,
    templateTitle: "Standard Eyebrow PMU Informed Consent",
    templateBody:
      "I hereby authorize the practitioner to perform the permanent makeup procedure on my eyebrows.\n\nI confirm that I have disclosed all relevant medical conditions, allergies, and medications.\n\nI understand the post-procedure care requirements and potential healing timeline.",
    signedAt: new Date("2026-10-05T14:30:00Z"),
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 400,
      height: 200,
      strokes: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 50, y: 40 },
            { x: 100, y: 80 },
            { x: 150, y: 50 },
          ],
        },
      ],
    },
  };

  it("1. Generates a valid PDF buffer matching standard magic bytes (%PDF-1.4)", () => {
    const pdfBuffer = generateConsentPdf(sampleData);

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);

    const header = pdfBuffer.subarray(0, 8).toString("utf8");
    expect(header.startsWith("%PDF-1.4")).toBe(true);

    const footer = pdfBuffer.subarray(pdfBuffer.length - 10).toString("utf8");
    expect(footer).toContain("%%EOF");
  });

  it("2. Successfully passes repository validateFile checks for consent documents", async () => {
    const pdfBuffer = generateConsentPdf(sampleData);
    const file = new File([new Uint8Array(pdfBuffer)], "consent.pdf", { type: "application/pdf" });

    const validation = await validateFile(file, {
      maxBytes: FILE_SIZE_LIMITS.CONSENT_MAX_BYTES,
      allowedTypes: ALLOWED_FORMATS.CONSENT_DOCUMENT,
    });

    expect(validation.fileType).toBe("pdf");
    expect(validation.size).toBe(pdfBuffer.length);
  });

  it("3. Computes deterministic SHA-256 matching exact PDF binary bytes", () => {
    const pdfBuffer = generateConsentPdf(sampleData);
    const hash = computePdfSha256(pdfBuffer);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Identical data produces identical hash
    const secondBuffer = generateConsentPdf(sampleData);
    const secondHash = computePdfSha256(secondBuffer);
    expect(secondHash).toBe(hash);
  });

  it("4. Includes all mandatory evidence fields in rendered PDF content", () => {
    const pdfBuffer = generateConsentPdf(sampleData);
    const pdfText = extractPdfText(pdfBuffer);

    expect(pdfText).toContain(sampleData.cycleId);
    expect(pdfText).toContain(sampleData.templateVersionId);
    expect(pdfText).toContain(sampleData.signatoryName);
    expect(pdfText).toContain("brows");
    expect(pdfText).toContain("Standard Eyebrow PMU Informed Consent");
    expect(pdfText).toContain("2026-10-05T14:30:00.000Z");
  });

  it("5. Correctly renders and preserves realistic Cyrillic / Unicode consent content", () => {
    const cyrillicData: ConsentPdfData = {
      studioId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      studioName: "Студия ПМУ Бишкек (Кыргызстан)",
      clientId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      clientName: "Айгуль Асанова",
      signatoryName: "Айгуль Асанова",
      signatoryRole: "client",
      cycleId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      zoneCode: "brows",
      templateId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      templateVersionId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      versionNumber: 2,
      templateTitle: "Согласие на проведение процедуры перманентного макияжа",
      templateBody:
        "Я подтверждаю, что ознакомилась с условиями процедуры.\n\nЗоны: брови, губы, глаза.\n\nКыргызстан\n№ 123",
      signedAt: new Date("2026-10-05T18:00:00Z"),
      signatureMethod: "draw_on_screen",
      signaturePayload: {
        format: "strokes_v1",
        width: 300,
        height: 150,
        strokes: [
          {
            points: [
              { x: 20, y: 30 },
              { x: 80, y: 70 },
              { x: 140, y: 40 },
            ],
          },
        ],
      },
    };

    const pdfBuffer = generateConsentPdf(cyrillicData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.subarray(0, 8).toString("utf8").startsWith("%PDF-1.4")).toBe(true);
    expect(pdfBuffer.subarray(pdfBuffer.length - 10).toString("utf8")).toContain("%%EOF");

    // SHA-256 is deterministic and valid hex
    const sha256 = computePdfSha256(pdfBuffer);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(computePdfSha256(generateConsentPdf(cyrillicData))).toBe(sha256);

    // Extract decoded Unicode text
    const extractedText = extractPdfText(pdfBuffer);

    // Verify Cyrillic text is preserved accurately with zero placeholder corruption
    expect(extractedText).toContain("Согласие на проведение процедуры перманентного макияжа");
    expect(extractedText).toContain("Я подтверждаю, что ознакомилась с условиями процедуры.");
    expect(extractedText).toContain("Зоны: брови, губы, глаза.");
    expect(extractedText).toContain("Кыргызстан");
    expect(extractedText).toContain("№ 123");
    expect(extractedText).toContain("Айгуль Асанова");
    expect(extractedText).toContain("Студия ПМУ Бишкек (Кыргызстан)");

    // Ensure no replacement characters, question marks, or broken glyphs
    expect(extractedText).not.toContain("?");
    expect(extractedText).not.toContain("\uFFFD");
  });
});
