import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { runPdfIngestExpandOne } from "@/lib/pdf-ingest-runner";

export const runtime = "nodejs";

/** One module expansion — own invocation budget (see `src/app/api/process-pdf/route.ts`). */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON: { jobId }." }, { status: 400 });
  }

  const jobId =
    body && typeof body === "object" && typeof (body as { jobId?: unknown }).jobId === "string"
      ? (body as { jobId: string }).jobId
      : "";

  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("pdf_ingest_jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await runPdfIngestExpandOne(jobId);

  if (result.kind === "failed") {
    const msg = result.message;
    const rateLimited =
      /rate limit|too many ai requests|tokens per minute|output tokens|exceed your organization/i.test(
        msg
      );
    return NextResponse.json(
      { error: msg },
      { status: rateLimited ? 429 : 500 }
    );
  }

  if (result.kind === "complete") {
    return NextResponse.json({
      complete: true,
      materialId: result.materialId,
    });
  }

  return NextResponse.json({
    complete: false,
    modulesBuilt: result.modulesBuilt,
    modulesTotal: result.modulesTotal,
  });
}
