import { randomUUID } from "node:crypto";
export function studioFixture() {
  return { name: "Synthetic test studio", slug: `test-${randomUUID()}`, timezone: "Europe/Rome" };
}
export function clientFixture(studioId: string) {
  return { studioId, phone: "+390000000000", clientStatus: "new_lead" as const, firstName: "Synthetic", fullName: "Synthetic Client", email: `${randomUUID()}@example.test` };
}
