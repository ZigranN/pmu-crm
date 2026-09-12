import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabaseUrl } from "./tests/support/database-url";
import { testEnvironment } from "./scripts/test-environment.mjs";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    env: { ...testEnvironment, ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) } : {}) },
    timeout: 60000,
  },
});
