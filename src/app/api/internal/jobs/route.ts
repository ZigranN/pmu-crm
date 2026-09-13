import { timingSafeEqual } from "node:crypto";
import { runWorkerOnce } from "@/server/events/worker";
import { handlers } from "@/server/events/registry";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Worker not configured" }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    let processed = 0;
    while (processed < 3 && await runWorkerOnce(handlers)) processed++;
    return Response.json({ processed });
  } catch { return Response.json({ error: "Worker unavailable" }, { status: 503 }); }
}
