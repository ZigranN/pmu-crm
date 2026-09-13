import { config } from "dotenv";
import { getSeedEnv } from "@/lib/env";

config({ path: ".env.local", quiet: true });

async function main() {
  const settings = getSeedEnv();
  // Load the connection only after dotenv and validation; close it on failure too.
  const { databaseClient } = await import("./index");
  try {
    const { seedDatabase } = await import("./seed-core");
    const result = await seedDatabase(settings);
    console.log("Seed completed.");
    console.log(result.adminLinked ? "Admin membership available." : "Configured admin account not found. Register it first, then rerun seed.");
    console.log(result.demoEnabled ? "Demo catalog initialized." : "Demo catalog disabled.");
  } finally { await databaseClient.end(); }
}

main().catch(() => {
  // Driver/Zod errors may contain connection strings or input values.
  console.error("Seed failed. Check configuration, migrations and legacy duplicates; no partial seed was committed.");
  process.exitCode = 1;
});
