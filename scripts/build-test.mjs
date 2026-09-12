import { spawnSync } from "node:child_process";
import { testEnvironment } from "./test-environment.mjs";
const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit", env: { ...process.env, ...testEnvironment },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
