import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
  } },
  test: {
    environment: "node",
    include: ["tests/{unit,integration,regressions}/**/*.test.ts"],
    setupFiles: ["./tests/support/setup.ts"],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 60000,
    allowOnly: !process.env.CI,
    restoreMocks: true,
  },
});
