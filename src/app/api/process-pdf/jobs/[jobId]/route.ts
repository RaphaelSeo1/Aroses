import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/**
 * Vercel Pro `maxDuration` is 300s — if the worker dies, `running` sticks until we synthesize failure.
 * Use ~6.5m so users are not stuck until the 11m client poll.
 */
const STALE_MS = 6 * 60 * 1000 + 30_000;

export async function GET(_request: Request, ctx: Params) {
  const { jobId } = await ctx.params;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("pdf_ingest_jobs")
    .select("status, material_id, error_message, updated_at")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const updatedAt =
    typeof row.updated_at === "string" ? Date.parse(row.updated_at) : NaN;
  const stale =
    (row.status === "pending" || row.status === "running") &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > STALE_MS;

  if (stale) {
    return NextResponse.json({
      status: "failed",
      materialId: undefined,
      error:
        "This build stopped responding (likely hit the server time limit or was interrupted). Try uploading the PDF again. On Vercel Pro, confirm `maxDuration` is 300 in code and deployed.",
    });
  }

  return NextResponse.json({
    status: row.status,
    materialId: row.material_id ?? undefined,
    error:
      typeof row.error_message === "string" && row.error_message.trim()
        ? row.error_message.trim()
        : undefined,
  });
}
