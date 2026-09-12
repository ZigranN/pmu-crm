import { expect, test } from "vitest";
import { assertTestDatabaseUrl } from "../support/database-url";
import { getPublicEnv } from "@/lib/env";

test.each([undefined, "postgresql://user:password@remote.example/pmu_test",
  "postgresql://localhost/neondb", "postgresql://localhost/pmu_test?host=remote.example",
  "https://localhost/pmu_test"])("rejects unsafe test database target %s", (url) => {
  expect(() => assertTestDatabaseUrl(url)).toThrow();
});
test("accepts only explicit scratch database and exposes no server env publicly", () => {
  expect(assertTestDatabaseUrl("postgresql://localhost/pmu_test")).toContain("pmu_test");
  expect(Object.keys(getPublicEnv())).toEqual(["NEXT_PUBLIC_APP_URL"]);
});
