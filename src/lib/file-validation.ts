/**
 * Authoritative Server-Side File Validation
 *
 * Validates binary magic-byte signatures and enforces strict size limits
 * before streaming to external storage providers (Cloudinary) or modifying the database.
 */

export type SupportedFileType = "jpeg" | "png" | "webp" | "pdf" | "heic";

export const FILE_SIZE_LIMITS = {
  GENERIC_MAX_BYTES: 5 * 1024 * 1024, // 5,242,880 bytes (5MB)
  MEDIA_MAX_BYTES: 10 * 1024 * 1024, // 10,485,760 bytes (10MB)
  CONSENT_MAX_BYTES: 10 * 1024 * 1024, // 10,485,760 bytes (10MB)
} as const;

export const ALLOWED_FORMATS = {
  GENERIC_IMAGE: ["jpeg", "png", "webp"] as SupportedFileType[],
  CLIENT_MEDIA: ["jpeg", "png", "webp", "heic"] as SupportedFileType[],
  CONSENT_DOCUMENT: ["pdf", "jpeg", "png", "webp"] as SupportedFileType[],
} as const;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

/**
 * Detects the file format from a binary header buffer (at least 12-64 bytes recommended).
 */
export function detectFileType(header: Buffer | Uint8Array): SupportedFileType | null {
  if (!header || header.length < 3) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "jpeg";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "png";
  }

  // 3. WebP: RIFF at 0..3 and WEBP at 8..11
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "webp";
  }

  // 4. PDF: %PDF- (25 50 44 46 2D)
  if (
    header.length >= 5 &&
    header[0] === 0x25 &&
    header[1] === 0x50 &&
    header[2] === 0x44 &&
    header[3] === 0x46 &&
    header[4] === 0x2d
  ) {
    return "pdf";
  }

  // 5. HEIC / HEIF / ISO Base Media: ftyp at 4..7
  if (
    header.length >= 12 &&
    header[4] === 0x66 &&
    header[5] === 0x74 &&
    header[6] === 0x79 &&
    header[7] === 0x70
  ) {
    const majorBrand = String.fromCharCode(
      header[8],
      header[9],
      header[10],
      header[11]
    ).toLowerCase();

    if (HEIC_BRANDS.has(majorBrand)) {
      return "heic";
    }

    // Check compatible brands if available in first 64 bytes
    for (let offset = 16; offset + 4 <= header.length; offset += 4) {
      const compatBrand = String.fromCharCode(
        header[offset],
        header[offset + 1],
        header[offset + 2],
        header[offset + 3]
      ).toLowerCase();
      if (HEIC_BRANDS.has(compatBrand)) {
        return "heic";
      }
    }
  }

  return null;
}

export class FileValidationError extends Error {
  constructor(message: string, public readonly code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID_HEADER") {
    super(message);
    this.name = "FileValidationError";
  }
}

export interface FileValidationOptions {
  maxBytes: number;
  allowedTypes: readonly SupportedFileType[];
}

/**
 * Authoritatively validates a File/Blob instance using size checks and magic bytes.
 * Throws FileValidationError on any check failure.
 */
export async function validateFile(
  file: File | Blob,
  options: FileValidationOptions
): Promise<{ fileType: SupportedFileType; size: number }> {
  if (!file || typeof file.size !== "number" || file.size === 0) {
    throw new FileValidationError("File cannot be empty", "EMPTY_FILE");
  }

  if (file.size > options.maxBytes) {
    const maxMB = Math.round(options.maxBytes / (1024 * 1024));
    throw new FileValidationError(
      `File too large. Maximum ${maxMB}MB allowed`,
      "FILE_TOO_LARGE"
    );
  }

  const headerSlice = await file.slice(0, 64).arrayBuffer();
  const headerBuffer = Buffer.from(headerSlice);

  if (headerBuffer.length < 3) {
    throw new FileValidationError("File is corrupt or incomplete", "INVALID_HEADER");
  }

  const detectedType = detectFileType(headerBuffer);

  if (!detectedType) {
    throw new FileValidationError(
      "Invalid file content: unrecognized file signature",
      "UNSUPPORTED_TYPE"
    );
  }

  if (!options.allowedTypes.includes(detectedType)) {
    throw new FileValidationError(
      `Unsupported file format (${detectedType}). Allowed formats: ${options.allowedTypes.join(", ")}`,
      "UNSUPPORTED_TYPE"
    );
  }

  return { fileType: detectedType, size: file.size };
}
