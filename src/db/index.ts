import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as relations from "./relations";
import { getDbEnv } from "@/lib/env";

const client = postgres(getDbEnv().DATABASE_URL);

export const db = drizzle(client, { 
  schema: { ...schema, ...relations } 
});
