import { randomUUID } from "node:crypto";
export function studioFixture() {
  return { name: "Synthetic test studio", slug: `test-${randomUUID()}`, timezone: "Europe/Rome" };
}
export function clientFixture(studioId: string) {
  return { studioId, phone: "+390000000000", clientStatus: "new_lead" as const, firstName: "Synthetic", fullName: "Synthetic Client", email: `${randomUUID()}@example.test` };
}

export const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
export const VALID_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const VALID_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

export function testImageFile(filename = "test.png", type = "image/png") {
  return new File([VALID_PNG_BYTES], filename, { type });
}

export function testPdfFile(filename = "consent.pdf", type = "application/pdf") {
  return new File([VALID_PDF_BYTES], filename, { type });
}
