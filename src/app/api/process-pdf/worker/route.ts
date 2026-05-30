import { after, NextResponse } from "next/server";
import { reapStaleIngestJobs } from "@/lib/pdf-ingest-runner";

export const runtime = "nodejs";

/** One reaper pass can drive several module batches — give it room. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/**
 * Background worker / reaper for the course-build pipeline.
 *
 * Module writing is normally driven by the browser's `/expand` polling. This
 * endpoint is the safety net: it re-kicks jobs that have stalled (tab closed,
 * lambda killed mid-flight) so builds always finish and never sit "stuck".
 *
 * Triggers:
 *   1. Vercel Cron (see vercel.json) — runs every minute on Pro.
 *   2. Self-chaining — while jobs remain active, schedules the next pass so it
 *      keeps advancing even without per-minute cron (e.g. Hobby plan).
 *
 * Auth: if `CRON_SECRET` is set, require it (Vercel Cron sends it automatically
 * as `Authorization: Bearer <CRON_SECRET>`; manual callers can use the
 * `x-cron-secret` header). If unset, the endpoint is open but only ever advances
 * already-created jobs — it accepts no caller-supplied content.
 */

const MAX_CHAIN_DEPTH = 60;
const SELF_CHAIN_DELAY_MS = 6_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  if (auth && auth === `Bearer ${secret}`) return true;
  const header = request.headers.get("x-cron-secret");
  return header === secret;
}

function selfBaseUrl(request: Request): string | null {
  const configured =
    process.env.PDF_INGEST_WORKER_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

function scheduleNextPass(request: Request, depth: number) {
  if (depth >= MAX_CHAIN_DEPTH) return;
  const base = selfBaseUrl(request);
  if (!base) return;
  const secret = process.env.CRON_SECRET?.trim();
  after(async () => {
    await new Promise((r) => setTimeout(r, SELF_CHAIN_DELAY_MS));
    try {
      await fetch(`${base}/api/process-pdf/worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-cron-secret": secret } : {}),
        },
        body: JSON.stringify({ depth: depth + 1 }),
        cache: "no-store",
      });
    } catch (e) {
      console.warn("[process-pdf/worker] self-chain fetch failed", e);
    }
  });
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let depth = 0;
  try {
    const body = (await request.json()) as { depth?: unknown };
    if (typeof body?.depth === "number" && Number.isFinite(body.depth)) {
      depth = body.depth;
    }
  } catch {
    // GET (cron) or empty body — depth stays 0.
  }

  const result = await reapStaleIngestJobs();

  // Keep the chain alive only while there is still work to do.
  if (result.remaining > 0) {
    scheduleNextPass(request, depth);
  }

  return NextResponse.json({
    ok: true,
    kicked: result.kicked,
    remaining: result.remaining,
    depth,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron issues GET requests.
export async function GET(request: Request) {
  return handle(request);
}
