import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as relations from "./relations";
import { getDbEnv } from "@/lib/env";

export const databaseClient = postgres(getDbEnv().DATABASE_URL);

export const db = drizzle(databaseClient, {
  schema: { ...schema, ...relations }
});
