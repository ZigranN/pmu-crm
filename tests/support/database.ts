import { PGlite } from "@electric-sql/pglite";
import { drizzle as embeddedDrizzle } from "drizzle-orm/pglite";
import { migrate as embeddedMigrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as tables from "@/db/schema";
import * as relations from "@/db/relations";
import { assertTestDatabaseUrl } from "./database-url";

export async function createTestDatabase() {
  const schema = { ...tables, ...relations };
  if (process.env.TEST_DATABASE_URL || process.env.REQUIRE_POSTGRES === "1") {
    const client = postgres(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), { max: 4 });
    const db = drizzle(client, { schema });
    try { await migrate(db, { migrationsFolder: "drizzle" }); }
    catch (error) { await client.end(); throw error; }
    return { db, close: () => client.end(), backend: "postgresql" };
  }
  const engine = new PGlite();
  const db = embeddedDrizzle(engine, { schema });
  try { await embeddedMigrate(db, { migrationsFolder: "drizzle" }); }
  catch (error) { await engine.close(); throw error; }
  return { db, close: () => engine.close(), backend: "pglite" };
}
