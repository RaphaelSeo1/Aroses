import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { streamMentoredNotes } from "@/lib/ai/generate-mentored-notes";
import type { KeyTerm } from "@/types/course";
import type { MentoredLessonChunk } from "@/types/mentored";

/**
 * POST /api/mentored/notes/[materialId]/generate-stream
 *
 * Streams free-form AI study notes for the current mentored chunk.
 *
 * Event stream:
 *   event: text   data: { delta: string }
 *   event: done    data: {}
 *   event: error  data: { message }
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

function isChunk(v: unknown): v is MentoredLessonChunk {
  if (!v || typeof v !== "object") return false;
  const c = v as MentoredLessonChunk;
  return (
    typeof c.id === "string" &&
    typeof c.concept === "string" &&
    typeof c.explanation === "string"
  );
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return jsonError("Invalid material id.", 400);
  }

  let body: {
    chunk?: unknown;
    courseTitle?: unknown;
    moduleTitle?: unknown;
    lessonTitle?: unknown;
    lessonExcerpt?: unknown;
    courseKeyTerms?: unknown;
    roseSpoken?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (!isChunk(body.chunk)) {
    return jsonError("Invalid chunk.", 400);
  }

  const courseTitle =
    typeof body.courseTitle === "string" ? body.courseTitle.trim() : "";
  const moduleTitle =
    typeof body.moduleTitle === "string" ? body.moduleTitle.trim() : "";
  if (!courseTitle || !moduleTitle) {
    return jsonError("courseTitle and moduleTitle are required.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not signed in", 401);
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return jsonError("Not found.", 404);
  }

  const lessonTitle =
    typeof body.lessonTitle === "string" ? body.lessonTitle.trim() : undefined;
  const lessonExcerpt =
    typeof body.lessonExcerpt === "string"
      ? body.lessonExcerpt.slice(0, 4_000)
      : undefined;
  const roseSpoken =
    typeof body.roseSpoken === "string"
      ? body.roseSpoken.slice(0, 6_000)
      : undefined;
  const courseKeyTerms = Array.isArray(body.courseKeyTerms)
    ? (body.courseKeyTerms as KeyTerm[])
    : undefined;

  console.log("AUTO-GENERATE: API generate-stream start", {
    materialId,
    chunkId: body.chunk.id,
    concept: body.chunk.concept,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseLine(event, data)));
        } catch {
          /* client disconnected */
        }
      };

      try {
        for await (const evt of streamMentoredNotes({
          chunk: body.chunk as MentoredLessonChunk,
          courseTitle,
          moduleTitle,
          lessonTitle,
          lessonExcerpt,
          courseKeyTerms,
          roseSpoken,
        })) {
          if (evt.type === "text") {
            send("text", { delta: evt.delta });
          }
        }
        send("done", {});
      } catch (e) {
        console.error("[mentored/notes/generate-stream]", e);
        send("error", {
          message: e instanceof Error ? e.message : "Generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
