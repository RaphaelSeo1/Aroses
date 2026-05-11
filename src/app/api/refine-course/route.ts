import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { refineCourseWithInstruction } from "@/lib/ai/refine-course";
import type { CoursePayload } from "@/types/course";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_INSTRUCTION = 8000;

function refineFailureMessage(err: unknown): string {
  if (err instanceof RateLimitError) {
    return "The AI hit a rate limit. Wait about a minute and try again.";
  }
  if (err instanceof APIConnectionError) {
    return "Could not reach the AI service. Check your connection and try again.";
  }
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    if (s === 529 || s === 503) {
      return "The AI service is temporarily overloaded. Try again in a few minutes.";
    }
    if (s === 413) {
      return "This course is too large for one refine request. Try describing a smaller change (one module or specific lessons).";
    }
    if (s === 400) {
      return "The request was rejected by the AI service. Try a shorter or more focused edit.";
    }
  }
  const msg = err instanceof Error ? err.message : "";
  if (msg === "REFINE_JSON_PARSE" || msg.includes("REFINE_REPAIR_JSON_PARSE")) {
    return "The model returned incomplete JSON (often because the course is very large). Try again, or ask for a narrower change — e.g. only module titles, or shorten one module.";
  }
  if (msg.includes("valid JSON after repair")) {
    return "Could not repair the model output. Try again with a smaller edit, or split into multiple refine steps.";
  }
  return "Could not refine the course right now. Wait a moment and try again, or ask for a more focused change (one topic or one module at a time).";
}

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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { materialId?: string; instruction?: string };

  if (typeof b.materialId !== "string" || !UUID_RE.test(b.materialId)) {
    return NextResponse.json({ error: "Invalid materialId" }, { status: 400 });
  }

  const instruction =
    typeof b.instruction === "string" ? b.instruction.trim() : "";

  if (instruction.length < 8) {
    return NextResponse.json(
      { error: "Describe what to change in at least a few words." },
      { status: 400 }
    );
  }

  if (instruction.length > MAX_INSTRUCTION) {
    return NextResponse.json({ error: "Instruction too long" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", b.materialId)
    .maybeSingle();

  if (fetchErr || !row?.course_payload) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const current = row.course_payload as CoursePayload;
  if (
    !current?.modules?.length ||
    typeof current.title !== "string"
  ) {
    return NextResponse.json({ error: "Nothing to refine yet" }, { status: 422 });
  }

  let revised: CoursePayload;
  try {
    revised = await refineCourseWithInstruction(current, instruction);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: refineFailureMessage(e) },
      { status: 502 }
    );
  }

  const { error: saveErr } = await supabase
    .from("study_materials")
    .update({
      course_payload: revised,
      summary: revised.description,
    })
    .eq("id", b.materialId);

  if (saveErr) {
    console.error(saveErr);
    return NextResponse.json(
      { error: "Could not save revised course." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
