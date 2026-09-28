import { NextResponse } from "next/server";
import { buildRunOptions } from "@/lib/course-build/billing";
import { sweepCourseBuilds } from "@/lib/course-build/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SWEEP_MS = 270_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === "development";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Vercel Cron, every minute: resumes builds whose worker died or whose
 * rate-limited steps are due. Builds run one at a time, each under its lease.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await sweepCourseBuilds({ ...buildRunOptions, deadlineAt: Date.now() + SWEEP_MS, limit: 10 });
  return NextResponse.json({
    swept: results.map((r) => ({ buildId: r.buildId, outcome: r.result.outcome })),
  });
}
