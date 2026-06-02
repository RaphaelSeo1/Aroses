import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  refineCourseWithInstruction,
  refineCourseWithInstructionStreaming,
} from "@/lib/ai/refine-course";
import {
  llmInstructionAfterPrep,
  prepareCourseForRefine,
} from "@/lib/ai/refine-course-ops";
import { coursePayloadChanged } from "@/lib/ai/refine-course-intent";
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
  if (msg === "REFINE_NO_CHANGES") {
    return "Rose didn't change anything. Try being more specific — e.g. \"Shorten module 2 lessons\" or \"Remove all images from every lesson.\"";
  }
  return "Could not refine the course right now. Wait a moment and try again, or ask for a more focused change (one topic or one module at a time).";
}

function noChangesMessage(): string {
  return "Rose didn't change anything. Try being more specific — name a module (\"module 3\"), or describe a concrete edit like \"shorten every lesson\" or \"remove all images.\"";
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

  const b = body as {
    materialId?: string;
    instruction?: string;
    stream?: boolean;
  };

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

  const wantStream = b.stream === true;

  const prep = await prepareCourseForRefine(b.materialId, current, instruction);
  const llmInstruction = llmInstructionAfterPrep(instruction, prep.applied);

  function assertChanged(revised: CoursePayload): string | null {
    if (coursePayloadChanged(current, revised)) return null;
    if (prep.applied.length > 0) return null;
    return noChangesMessage();
  }

  async function saveRevised(revised: CoursePayload) {
    const { error: saveErr } = await supabase
      .from("study_materials")
      .update({
        course_payload: revised,
        summary: revised.description,
      })
      .eq("id", b.materialId);

    if (saveErr) {
      console.error(saveErr);
      return false;
    }
    return true;
  }

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };

        send({
          type: "phase",
          message: prep.applied.length
            ? prep.applied.join(" ")
            : "Step 1/2: Revising your course with AI (longer courses need more time)…",
        });

        let revised: CoursePayload;
        try {
          if (prep.skipLlm) {
            revised = prep.course;
          } else {
            revised = await refineCourseWithInstructionStreaming(
              prep.course,
              llmInstruction,
              prep.intent
            );
          }
        } catch (e) {
          console.error(e);
          send({ type: "error", message: refineFailureMessage(e) });
          controller.close();
          return;
        }

        const unchanged = assertChanged(revised);
        if (unchanged) {
          send({ type: "error", message: unchanged });
          controller.close();
          return;
        }

        send({
          type: "phase",
          message: "Step 2/2: Saving your updated study set…",
        });

        const ok = await saveRevised(revised);
        if (!ok) {
          send({ type: "error", message: "Could not save revised course." });
          controller.close();
          return;
        }

        send({
          type: "done",
          applied: prep.applied.length ? prep.applied : undefined,
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  let revised: CoursePayload;
  try {
    if (prep.skipLlm) {
      revised = prep.course;
    } else {
      revised = await refineCourseWithInstruction(
        prep.course,
        llmInstruction,
        prep.intent
      );
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: refineFailureMessage(e) },
      { status: 502 }
    );
  }

  const unchanged = assertChanged(revised);
  if (unchanged) {
    return NextResponse.json({ error: unchanged }, { status: 422 });
  }

  const ok = await saveRevised(revised);
  if (!ok) {
    return NextResponse.json(
      { error: "Could not save revised course." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    applied: prep.applied.length ? prep.applied : undefined,
  });
}
