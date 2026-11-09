import { describe, expect, it } from "vitest";
import {
  detectFileType,
  validateFile,
  FILE_SIZE_LIMITS,
  ALLOWED_FORMATS,
  FileValidationError,
} from "@/lib/file-validation";

describe("File Validation Unit Tests", () => {
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const WEBP_BYTES = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ]);
  const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
  const HEIC_BYTES = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // box size
    0x66, 0x74, 0x79, 0x70, // ftyp
    0x68, 0x65, 0x69, 0x63, // heic
    0x00, 0x00, 0x00, 0x00,
  ]);
  const SVG_BYTES = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");
  const TEXT_BYTES = Buffer.from("Hello world, this is a plain text file.");
  const HTML_BYTES = Buffer.from("<!DOCTYPE html><html><body><h1>Payload</h1></body></html>");

  describe("detectFileType", () => {
    it("detects JPEG from magic bytes", () => {
      expect(detectFileType(JPEG_BYTES)).toBe("jpeg");
    });

    it("detects PNG from magic bytes", () => {
      expect(detectFileType(PNG_BYTES)).toBe("png");
    });

    it("detects WebP from magic bytes", () => {
      expect(detectFileType(WEBP_BYTES)).toBe("webp");
    });

    it("detects PDF from magic bytes", () => {
      expect(detectFileType(PDF_BYTES)).toBe("pdf");
    });

    it("detects HEIC from ftyp box brand", () => {
      expect(detectFileType(HEIC_BYTES)).toBe("heic");
    });

    it("returns null for SVG, HTML, text, and unknown signatures", () => {
      expect(detectFileType(SVG_BYTES)).toBeNull();
      expect(detectFileType(TEXT_BYTES)).toBeNull();
      expect(detectFileType(HTML_BYTES)).toBeNull();
      expect(detectFileType(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
      expect(detectFileType(Buffer.alloc(0))).toBeNull();
    });
  });

  describe("validateFile", () => {
    it("accepts valid JPEG within size limits for generic image", async () => {
      const file = new File([JPEG_BYTES], "avatar.jpg", { type: "image/jpeg" });
      const result = await validateFile(file, {
        maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
      });
      expect(result.fileType).toBe("jpeg");
      expect(result.size).toBe(JPEG_BYTES.length);
    });

    it("accepts valid PNG within size limits for generic image", async () => {
      const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });
      const result = await validateFile(file, {
        maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
      });
      expect(result.fileType).toBe("png");
    });

    it("accepts valid WebP within size limits", async () => {
      const file = new File([WEBP_BYTES], "photo.webp", { type: "image/webp" });
      const result = await validateFile(file, {
        maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
      });
      expect(result.fileType).toBe("webp");
    });

    it("accepts valid JPEG with application/octet-stream MIME type (MIME is non-authoritative)", async () => {
      const file = new File([JPEG_BYTES], "avatar.bin", {
        type: "application/octet-stream",
      });
      const result = await validateFile(file, {
        maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
      });
      expect(result.fileType).toBe("jpeg");
    });

    it("enforces exact 5MB boundary: 5,242,880 bytes allowed, 5,242,881 bytes rejected", async () => {
      const limit = FILE_SIZE_LIMITS.GENERIC_MAX_BYTES; // 5,242,880
      const exactBuffer = Buffer.concat([
        JPEG_BYTES,
        Buffer.alloc(limit - JPEG_BYTES.length),
      ]);
      expect(exactBuffer.length).toBe(limit);

      const exactFile = new File([exactBuffer], "exact-5mb.jpg", {
        type: "image/jpeg",
      });
      const allowedResult = await validateFile(exactFile, {
        maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
      });
      expect(allowedResult.fileType).toBe("jpeg");
      expect(allowedResult.size).toBe(limit);

      const overBuffer = Buffer.concat([exactBuffer, Buffer.alloc(1)]);
      expect(overBuffer.length).toBe(limit + 1);

      const overFile = new File([overBuffer], "over-5mb.jpg", {
        type: "image/jpeg",
      });
      await expect(
        validateFile(overFile, {
          maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow(FileValidationError);
    });

    it("enforces exact 10MB boundary: 10,485,760 bytes allowed, 10,485,761 bytes rejected", async () => {
      const limit = FILE_SIZE_LIMITS.MEDIA_MAX_BYTES; // 10,485,760
      const exactBuffer = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(limit - PNG_BYTES.length),
      ]);
      expect(exactBuffer.length).toBe(limit);

      const exactFile = new File([exactBuffer], "exact-10mb.png", {
        type: "image/png",
      });
      const allowedResult = await validateFile(exactFile, {
        maxBytes: FILE_SIZE_LIMITS.MEDIA_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.CLIENT_MEDIA,
      });
      expect(allowedResult.fileType).toBe("png");
      expect(allowedResult.size).toBe(limit);

      const overBuffer = Buffer.concat([exactBuffer, Buffer.alloc(1)]);
      expect(overBuffer.length).toBe(limit + 1);

      const overFile = new File([overBuffer], "over-10mb.png", {
        type: "image/png",
      });
      await expect(
        validateFile(overFile, {
          maxBytes: FILE_SIZE_LIMITS.MEDIA_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.CLIENT_MEDIA,
        })
      ).rejects.toThrow(FileValidationError);
    });

    it("rejects empty file (0 bytes)", async () => {
      const emptyFile = new File([], "empty.jpg", { type: "image/jpeg" });
      await expect(
        validateFile(emptyFile, {
          maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow(FileValidationError);
    });

    it("rejects file exceeding maxBytes limit", async () => {
      const bigBuffer = Buffer.concat([JPEG_BYTES, Buffer.alloc(100)]);
      const file = new File([bigBuffer], "big.jpg", { type: "image/jpeg" });
      await expect(
        validateFile(file, {
          maxBytes: 50, // lower than file size
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow(FileValidationError);
    });

    it("rejects MIME spoofed text disguised as JPEG", async () => {
      const spoofedFile = new File([TEXT_BYTES], "malicious.jpg", {
        type: "image/jpeg",
      });
      await expect(
        validateFile(spoofedFile, {
          maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow("Invalid file content: unrecognized file signature");
    });

    it("rejects SVG uploads even when declared as image/svg+xml or image/png", async () => {
      const svgFile = new File([SVG_BYTES], "image.png", {
        type: "image/png",
      });
      await expect(
        validateFile(svgFile, {
          maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow(FileValidationError);
    });

    it("rejects PDF in generic image allowlist", async () => {
      const pdfFile = new File([PDF_BYTES], "doc.pdf", {
        type: "application/pdf",
      });
      await expect(
        validateFile(pdfFile, {
          maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
          allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
        })
      ).rejects.toThrow("Unsupported file format (pdf)");
    });

    it("accepts PDF in consent document allowlist", async () => {
      const pdfFile = new File([PDF_BYTES], "consent.pdf", {
        type: "application/pdf",
      });
      const result = await validateFile(pdfFile, {
        maxBytes: FILE_SIZE_LIMITS.CONSENT_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.CONSENT_DOCUMENT,
      });
      expect(result.fileType).toBe("pdf");
    });

    it("accepts HEIC in client media allowlist", async () => {
      const heicFile = new File([HEIC_BYTES], "clinical.heic", {
        type: "image/heic",
      });
      const result = await validateFile(heicFile, {
        maxBytes: FILE_SIZE_LIMITS.MEDIA_MAX_BYTES,
        allowedTypes: ALLOWED_FORMATS.CLIENT_MEDIA,
      });
      expect(result.fileType).toBe("heic");
    });
  });
});
