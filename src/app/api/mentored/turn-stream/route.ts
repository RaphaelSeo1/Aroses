import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { runMentoredTurnStream } from "@/lib/ai/mentored";
import { loadMentoredPersonalization } from "@/lib/mentored/load-personalization";
import type {
  KnowledgeLevel,
  MentoredLessonChunk,
  MentoredPersonalization,
  MentoredTurnRequest,
} from "@/types/mentored";

/**
 * POST /api/mentored/turn-stream
 *
 * Same input as `/api/mentored/turn` but responds with Server-Sent
 * Events so the client can start TTS on the FIRST sentence before
 * Claude has finished generating the full reply. This is the main
 * latency lever for Mentored Learning: with the non-streaming endpoint
 * the student waits for the full ~3-6s response; here they start
 * hearing the tutor within 1-2s.
 *
 * Event stream:
 *   event: text   data: { delta: string }   — incremental reply tokens
 *   event: meta   data: { intent, advance, addToFocusedReview }
 *   event: done   data: {}
 *   event: error  data: { message }
 *
 * Focused-Review side-effect: same as the non-streaming route — if
 * `addToFocusedReview` flips true we insert a `user_personal_quiz_items`
 * row server-side AFTER the stream finishes, before emitting `done`.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLevel(v: unknown): v is KnowledgeLevel {
  return v === "beginner" || v === "intermediate" || v === "advanced";
}

function isChunk(v: unknown): v is MentoredLessonChunk {
  if (!v || typeof v !== "object") return false;
  const c = v as MentoredLessonChunk;
  return (
    typeof c.concept === "string" &&
    typeof c.explanation === "string" &&
    typeof c.checkQuestion === "string" &&
    typeof c.referenceAnswer === "string"
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

export async function POST(request: Request) {
  let body: MentoredTurnRequest;
  try {
    body = (await request.json()) as MentoredTurnRequest;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return jsonError("Invalid material id.", 400);
  }
  if (typeof body.moduleId !== "number" || !Number.isFinite(body.moduleId)) {
    return jsonError("Invalid module id.", 400);
  }
  if (!isChunk(body.chunk)) {
    return jsonError("Invalid chunk.", 400);
  }
  if (typeof body.attempts !== "number" || body.attempts < 0) {
    return jsonError("Invalid attempts.", 400);
  }
  if (
    typeof body.studentUtterance !== "string" ||
    body.studentUtterance.trim().length === 0
  ) {
    return jsonError("studentUtterance is required.", 400);
  }
  const level: KnowledgeLevel = isLevel(body.knowledgeLevel)
    ? body.knowledgeLevel
    : "beginner";
  // Optional context: when the student barged in mid-utterance, this
  // is the text Rose had already spoken out loud (and the student
  // actually heard). The turn prompt uses it so Rose can acknowledge
  // the interruption and offer to resume from there rather than
  // restarting her explanation cold.
  const interruptedAfter =
    typeof body.interruptedAfter === "string" &&
    body.interruptedAfter.trim().length > 0
      ? body.interruptedAfter.trim().slice(0, 800)
      : undefined;
  // Pacing signals for smart question timing. Both are nullable —
  // null means "no prior signal yet this session". We clamp negative
  // values to undefined in case the client's clock drifted.
  const secondsSinceLastCheck =
    typeof body.secondsSinceLastCheck === "number" &&
    Number.isFinite(body.secondsSinceLastCheck) &&
    body.secondsSinceLastCheck >= 0
      ? body.secondsSinceLastCheck
      : null;
  const secondsSinceStudentSpoke =
    typeof body.secondsSinceStudentSpoke === "number" &&
    Number.isFinite(body.secondsSinceStudentSpoke) &&
    body.secondsSinceStudentSpoke >= 0
      ? body.secondsSinceStudentSpoke
      : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Not signed in", 401);

  const ok = await canAccessStudyMaterial(supabase, user.id, body.materialId);
  if (!ok) return jsonError("Not found.", 404);

  const userId = user.id;
  const materialId = body.materialId;
  const moduleId = body.moduleId;
  const chunk = body.chunk;

  // ---- personalization: read once, lazily extract on first turn ----
  // Reading + (maybe) extracting BEFORE we open the stream so the
  // prompt has the personalization signals from the very first token.
  // Worst case (extraction needed): ~600-800ms added to first turn.
  // After that the row is cached on subsequent turns.
  let personalization: MentoredPersonalization = {};
  let shouldPersistPersonalization = false;
  try {
    const loaded = await loadMentoredPersonalization(
      supabase,
      userId,
      materialId
    );
    personalization = loaded.personalization;
    shouldPersistPersonalization = loaded.shouldPersist;
  } catch (e) {
    console.error("[mentored/turn-stream personalization-read]", e);
  }

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

      let addToFocusedReview = false;

      try {
        let finalIntent: string | undefined;
        for await (const evt of runMentoredTurnStream({
          chunk,
          attempts: body.attempts,
          studentUtterance: body.studentUtterance,
          knowledgeLevel: level,
          interruptedAfter,
          secondsSinceLastCheck,
          secondsSinceStudentSpoke,
          personalization,
        })) {
          if (evt.type === "text") {
            send("text", { delta: evt.delta });
          } else if (evt.type === "meta") {
            addToFocusedReview = evt.addToFocusedReview;
            finalIntent = evt.intent;
            send("meta", {
              intent: evt.intent,
              advance: evt.advance,
              addToFocusedReview: evt.addToFocusedReview,
              imageRequest: evt.imageRequest,
            });
          }
        }

        // Mid-course pacing self-tuning. When the student explicitly
        // asks Rose to slow down OR speed up via natural language
        // ("this is too basic", "slow down"), nudge their stored
        // experienceLevel one notch in that direction so subsequent
        // turns inherit the calibration. We only ever nudge by 1
        // level per turn (no jumping beginner → advanced in one go)
        // and only when there's actually a stored level to adjust.
        if (
          (finalIntent === "pace_slower" || finalIntent === "pace_faster") &&
          personalization.experienceLevel
        ) {
          const order: KnowledgeLevel[] = [
            "beginner",
            "intermediate",
            "advanced",
          ];
          const i = order.indexOf(personalization.experienceLevel);
          const nextIdx =
            finalIntent === "pace_faster"
              ? Math.min(order.length - 1, i + 1)
              : Math.max(0, i - 1);
          if (nextIdx !== i) {
            personalization = {
              ...personalization,
              experienceLevel: order[nextIdx],
            };
            shouldPersistPersonalization = true;
          }
        }

        if (shouldPersistPersonalization) {
          try {
            await supabase
              .from("user_course_onboarding")
              .update({
                personalization,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("material_id", materialId);
          } catch (e) {
            // Non-fatal — next turn re-extracts.
            console.error("[mentored/turn-stream personalization-save]", e);
          }
        }

        // Persist Focused Review insertion BEFORE done so the client can
        // safely advance once the stream closes.
        if (addToFocusedReview) {
          try {
            await supabase.from("user_personal_quiz_items").insert({
              user_id: userId,
              material_id: materialId,
              module_id: moduleId,
              item: {
                type: "free_response",
                question: chunk.checkQuestion,
                referenceAnswer: chunk.referenceAnswer,
                explanation: chunk.explanation,
              },
            });
          } catch (e) {
            // Non-fatal — student still gets their reply.
            console.error("[mentored/turn-stream focused-review]", e);
          }
        }

        send("done", {});
      } catch (e) {
        console.error("[mentored/turn-stream]", e);
        send("error", { message: "AI could not respond. Try again shortly." });
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
