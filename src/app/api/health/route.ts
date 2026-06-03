import { db } from "@/db";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    // Проверка подключения к БД
    await db.execute(sql`SELECT 1`);

    return NextResponse.json({
      ok: true,
      app: "PMU CRM V2",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        ok: false,
        app: "PMU CRM V2",
        database: "disconnected",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
