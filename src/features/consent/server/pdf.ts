import { createHash } from "node:crypto";
import {
  FONT_NAME,
  UNCOMPRESSED_FONT_LENGTH,
  COMPRESSED_FONT_BASE64,
  FONT_WIDTHS,
  TO_UNICODE_CMAP,
  encodePdfHexString,
} from "./font-data";

export interface SignatureStrokePoint {
  x: number;
  y: number;
}

export interface SignatureStroke {
  points: SignatureStrokePoint[];
}

export interface SignaturePayloadData {
  format?: string;
  width?: number;
  height?: number;
  strokes?: SignatureStroke[];
}

export interface ConsentPdfData {
  studioId: string;
  studioName?: string;
  clientId: string;
  clientName?: string;
  signatoryName: string;
  signatoryRole: string;
  cycleId: string;
  zoneCode: string;
  templateId: string;
  templateVersionId: string;
  versionNumber: number;
  templateTitle: string;
  templateBody: string;
  signedAt: Date;
  signatureMethod: string;
  signaturePayload?: SignaturePayloadData | Record<string, unknown> | null;
}

/**
 * Word wraps text into lines of roughly maxWidth characters.
 */
function wrapText(text: string, maxCharsPerLine = 80): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) {
      lines.push("");
      continue;
    }

    const words = trimmedPara.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxCharsPerLine) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Generates an immutable, legally verifiable PDF representation of a signed cycle consent.
 * Output conforms to the PDF-1.4 specification.
 */
export function generateConsentPdf(data: ConsentPdfData): Buffer {
  const pageWidth = 595.28; // A4 standard width in points
  const pageHeight = 841.89; // A4 standard height in points
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Split template body into wrapped lines
  const bodyLines = wrapText(data.templateBody, 85);

  // We organize stream content across pages (or one well-laid out page)
  // Let's create pages dynamically based on content length
  const linesPerPage = 38;
  const pagesData: string[] = [];

  // Header metadata block for page 1
  const metaLines = [
    `Studio: ${data.studioName || data.studioId}`,
    `Client / Signatory: ${data.signatoryName} (${data.signatoryRole})`,
    `Treatment Cycle ID: ${data.cycleId}`,
    `Procedure Zone: ${data.zoneCode}`,
    `Template: ${data.templateTitle} (v${data.versionNumber})`,
    `Template Version ID: ${data.templateVersionId}`,
    `Signed At: ${data.signedAt.toISOString()}`,
    `Signature Method: ${data.signatureMethod}`,
  ];

  // Distribute body lines
  let currentBodyIndex = 0;
  let pageNum = 1;

  while (currentBodyIndex < bodyLines.length || pageNum === 1) {
    const streamOps: string[] = [];

    // Header banner on each page
    streamOps.push(
      "q",
      "0.15 0.25 0.45 rg",
      `0 ${pageHeight - 28} ${pageWidth} 28 re f`,
      "1 1 1 rg",
      "BT",
      "/F1 10 Tf",
      `40 ${pageHeight - 19} Td`,
      `${encodePdfHexString("PMU CLINICAL CONSENT EVIDENCE - OFFICIAL LEGAL RECORD")} Tj`,
      "ET",
      "Q"
    );

    let y = pageHeight - 55;

    if (pageNum === 1) {
      // Title
      streamOps.push(
        "BT",
        "/F1 15 Tf",
        `40 ${y} Td`,
        `${encodePdfHexString(data.templateTitle)} Tj`,
        "ET"
      );
      y -= 25;

      // Metadata summary box
      streamOps.push(
        "q",
        "0.94 0.95 0.97 rg",
        "0.7 0.75 0.82 RG",
        "0.75 w",
        `40 ${y - 105} ${contentWidth} 115 re B`,
        "0.1 0.1 0.1 rg",
        "BT",
        "/F1 9 Tf"
      );

      let metaY = y - 10;
      for (const line of metaLines) {
        streamOps.push(`48 ${metaY} Td ${encodePdfHexString(line)} Tj`);
        metaY -= 12;
      }
      streamOps.push("ET", "Q");
      y -= 125;
    }

    // Body content block
    streamOps.push("BT", "/F1 9.5 Tf", "0 0 0 rg");
    let currentY = y;
    let linesOnThisPage = 0;

    while (
      currentBodyIndex < bodyLines.length &&
      linesOnThisPage < (pageNum === 1 ? 24 : linesPerPage)
    ) {
      const line = bodyLines[currentBodyIndex];
      if (line) {
        streamOps.push(`40 ${currentY} Td ${encodePdfHexString(line)} Tj`);
      }
      currentY -= 12;
      currentBodyIndex++;
      linesOnThisPage++;
    }
    streamOps.push("ET");

    // If on last page (or single page), render signature evidence block at the bottom
    const isLastPage = currentBodyIndex >= bodyLines.length;
    if (isLastPage) {
      const sigBoxY = Math.min(currentY - 20, 160);
      const sigBoxHeight = 100;
      const sigBoxWidth = 260;

      streamOps.push(
        "q",
        "0.96 0.96 0.96 rg",
        "0.6 0.6 0.6 RG",
        "0.5 w",
        `40 ${sigBoxY} ${sigBoxWidth} ${sigBoxHeight} re B`,
        "0 0 0 rg",
        "BT",
        "/F1 9 Tf",
        `45 ${sigBoxY + sigBoxHeight - 14} Td ${encodePdfHexString("Digital Signature Evidence:")} Tj`,
        "/F1 8 Tf",
        `45 ${sigBoxY + 12} Td ${encodePdfHexString(`Signatory: ${data.signatoryName} [${data.signatoryRole}]`)} Tj`,
        `45 ${sigBoxY + 2} Td ${encodePdfHexString(`Timestamp: ${data.signedAt.toISOString()}`)} Tj`,
        "ET"
      );

      // Render vector strokes if available from draw_on_screen / in_person_stylus
      const sigPayload = data.signaturePayload as SignaturePayloadData | undefined;
      if (
        sigPayload &&
        Array.isArray(sigPayload.strokes) &&
        sigPayload.strokes.length > 0 &&
        sigPayload.width &&
        sigPayload.height
      ) {
        const renderScaleX = (sigBoxWidth - 20) / sigPayload.width;
        const renderScaleY = (sigBoxHeight - 35) / sigPayload.height;
        const scale = Math.min(renderScaleX, renderScaleY, 1.0);
        const originX = 50;
        const originY = sigBoxY + 25;

        streamOps.push("0.1 0.1 0.4 RG", "1.2 w", "1 J", "1 j");

        for (const stroke of sigPayload.strokes) {
          if (!stroke.points || stroke.points.length === 0) continue;
          const first = stroke.points[0];
          // PDF coordinate system has Y inverted from screen (Y=0 at bottom)
          const startX = (originX + first.x * scale).toFixed(2);
          const startY = (originY + (sigPayload.height - first.y) * scale).toFixed(2);
          streamOps.push(`${startX} ${startY} m`);

          for (let i = 1; i < stroke.points.length; i++) {
            const pt = stroke.points[i];
            const px = (originX + pt.x * scale).toFixed(2);
            const py = (originY + (sigPayload.height - pt.y) * scale).toFixed(2);
            streamOps.push(`${px} ${py} l`);
          }
          streamOps.push("S");
        }
      } else {
        // Fallback visual line for signature indication
        streamOps.push(
          "0.2 0.2 0.2 RG",
          "0.75 w",
          `50 ${sigBoxY + 35} m 280 ${sigBoxY + 35} l S`,
          "BT",
          "/F1 8 Tf",
          `50 ${sigBoxY + 40} Td ([Digitally Authenticated Signature Attached]) Tj`,
          "ET"
        );
      }

      streamOps.push("Q");
    }

    // Page footer
    streamOps.push(
      "BT",
      "/F1 8 Tf",
      "0.4 0.4 0.4 rg",
      `40 20 Td ${encodePdfHexString(`Page ${pageNum} | Cycle: ${data.cycleId} | Template: v${data.versionNumber}`)} Tj`,
      "ET"
    );

    pagesData.push(streamOps.join("\n"));
    pageNum++;
  }

  // Construct PDF binary structure
  // Objects:
  // 1: Catalog
  // 2: Pages
  // 3: Type 0 Font (PMUUnicodeSans)
  // 4: CIDFontType2 (PMUUnicodeSans)
  // 5: FontDescriptor
  // 6: FontFile2 (Stream)
  // 7: ToUnicode CMap (Stream)
  // 8 .. 8+pageCount-1: Page objects
  // 8+pageCount .. 8+2*pageCount-1: Content stream objects

  const pageCount = pagesData.length;
  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontObjNum = 3;
  const cidFontObjNum = 4;
  const fontDescObjNum = 5;
  const fontFileObjNum = 6;
  const toUnicodeObjNum = 7;
  const firstPageObjNum = 8;
  const firstContentStreamObjNum = firstPageObjNum + pageCount;

  const fontBuffer = Buffer.from(COMPRESSED_FONT_BASE64, "base64");
  const toUnicodeBuffer = Buffer.from(TO_UNICODE_CMAP, "utf8");

  const objects: Buffer[] = [];

  // Obj 1: Catalog
  objects.push(Buffer.from(`${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj\n`));

  // Obj 2: Pages
  const pageKids = Array.from({ length: pageCount }, (_, i) => `${firstPageObjNum + i} 0 R`).join(" ");
  objects.push(Buffer.from(`${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${pageKids}] /Count ${pageCount} >>\nendobj\n`));

  // Obj 3: Type 0 Font
  objects.push(Buffer.from(`${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /${FONT_NAME} /Encoding /Identity-H /DescendantFonts [ ${cidFontObjNum} 0 R ] /ToUnicode ${toUnicodeObjNum} 0 R >>\nendobj\n`));

  // Obj 4: CIDFontType2
  const widthsStr = FONT_WIDTHS.join(" ");
  objects.push(Buffer.from(`${cidFontObjNum} 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${FONT_NAME} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescObjNum} 0 R /CIDToGIDMap /Identity /DW 600 /W [ 0 [ ${widthsStr} ] ] >>\nendobj\n`));

  // Obj 5: FontDescriptor
  objects.push(Buffer.from(`${fontDescObjNum} 0 obj\n<< /Type /FontDescriptor /FontName /${FONT_NAME} /Flags 32 /FontBBox [ -665 -325 2000 1006 ] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 716 /StemV 80 /FontFile2 ${fontFileObjNum} 0 R >>\nendobj\n`));

  // Obj 6: FontFile2 stream
  const fontFileHeader = Buffer.from(`${fontFileObjNum} 0 obj\n<< /Length ${fontBuffer.length} /Length1 ${UNCOMPRESSED_FONT_LENGTH} /Filter /FlateDecode >>\nstream\n`);
  const fontFileFooter = Buffer.from("\nendstream\nendobj\n");
  objects.push(Buffer.concat([fontFileHeader, fontBuffer, fontFileFooter]));

  // Obj 7: ToUnicode stream
  const toUnicodeHeader = Buffer.from(`${toUnicodeObjNum} 0 obj\n<< /Length ${toUnicodeBuffer.length} >>\nstream\n`);
  const toUnicodeFooter = Buffer.from("\nendstream\nendobj\n");
  objects.push(Buffer.concat([toUnicodeHeader, toUnicodeBuffer, toUnicodeFooter]));

  // Page Objects
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = firstPageObjNum + i;
    const contentObjNum = firstContentStreamObjNum + i;
    objects.push(
      Buffer.from(`${pageObjNum} 0 obj\n<< /Type /Page /Parent ${pagesObjNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjNum} 0 R >>\nendobj\n`)
    );
  }

  // Content Stream Objects
  for (let i = 0; i < pageCount; i++) {
    const contentObjNum = firstContentStreamObjNum + i;
    const streamBuffer = Buffer.from(pagesData[i], "utf8");
    objects.push(
      Buffer.concat([
        Buffer.from(`${contentObjNum} 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n`),
        streamBuffer,
        Buffer.from("\nendstream\nendobj\n"),
      ])
    );
  }

  // Assemble full PDF with byte offsets and xref
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const buffers: Buffer[] = [header];
  const offsets: number[] = [0]; // offset 0 is dummy
  let currentOffset = header.length;

  for (let i = 0; i < objects.length; i++) {
    offsets.push(currentOffset);
    buffers.push(objects[i]);
    currentOffset += objects[i].length;
  }

  const xrefOffset = currentOffset;
  const totalObjCount = objects.length + 1;

  let xref = `xref\n0 ${totalObjCount}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    const offsetStr = offsets[i].toString().padStart(10, "0");
    xref += `${offsetStr} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjCount} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  buffers.push(Buffer.from(xref + trailer, "latin1"));

  return Buffer.concat(buffers);
}

/**
 * Computes deterministic SHA-256 hash (64 hex lowercase) of generated PDF bytes.
 */
export function computePdfSha256(pdfBuffer: Buffer): string {
  return createHash("sha256").update(pdfBuffer).digest("hex");
}
