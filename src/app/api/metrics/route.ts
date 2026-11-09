import { NextResponse } from "next/server";
import { getOperationalMetricsSummary } from "@/server/observability/metrics";
import { extractCorrelationId } from "@/lib/observability/correlation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = extractCorrelationId(request.headers);

  // Check authorization via Bearer token or internal header if configured
  const authHeader = request.headers.get("authorization");
  const workerSecret = process.env.WORKER_SECRET;

  if (workerSecret && workerSecret.trim().length > 0) {
    const expected = `Bearer ${workerSecret.trim()}`;
    if (authHeader !== expected) {
      return NextResponse.json(
        { error: "Unauthorized metrics access" },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }
  }

  const url = new URL(request.url);
  const studioId = url.searchParams.get("studioId") || undefined;

  const metrics = await getOperationalMetricsSummary(studioId);

  return NextResponse.json(metrics, {
    status: 200,
    headers: { "x-request-id": requestId },
  });
}
