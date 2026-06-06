import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import { runMentoredTurn } from "@/lib/ai/mentored";
import { loadMentoredPersonalization } from "@/lib/mentored/load-personalization";
import type {
  KnowledgeLevel,
  MentoredLessonChunk,
  MentoredTurnRequest,
  MentoredTurnResponse,
} from "@/types/mentored";

/**
 * POST /api/mentored/turn
 *
 * Body: `MentoredTurnRequest`
 *
 * Runs the per-utterance classifier + reply generator. If the response
 * indicates `addToFocusedReview = true`, the route ALSO inserts a new
 * personal-quiz item (Focused Review card) for the underlying concept
 * so the student sees it later in spaced repetition.
 *
 * The route does NOT mutate user_mentored_sessions.attempt_state or
 * advance the chunk index — the client handles that via the session
 * upsert endpoint after rendering the AI's reply.
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

export async function POST(request: Request) {
  let body: MentoredTurnRequest;
  try {
    body = (await request.json()) as MentoredTurnRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.materialId !== "string" || !UUID_RE.test(body.materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }
  if (typeof body.moduleId !== "number" || !Number.isFinite(body.moduleId)) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }
  if (!isChunk(body.chunk)) {
    return NextResponse.json({ error: "Invalid chunk." }, { status: 400 });
  }
  if (typeof body.attempts !== "number" || body.attempts < 0) {
    return NextResponse.json({ error: "Invalid attempts." }, { status: 400 });
  }
  if (
    typeof body.studentUtterance !== "string" ||
    body.studentUtterance.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "studentUtterance is required." },
      { status: 400 }
    );
  }
  const level: KnowledgeLevel = isLevel(body.knowledgeLevel)
    ? body.knowledgeLevel
    : "beginner";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, body.materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let personalization = {};
  try {
    const loaded = await loadMentoredPersonalization(
      supabase,
      user.id,
      body.materialId
    );
    personalization = loaded.personalization;
  } catch (e) {
    console.error("[mentored/turn personalization-read]", e);
  }

  let turn: MentoredTurnResponse;
  try {
    const result = await runMentoredTurn({
      chunk: body.chunk,
      attempts: body.attempts,
      studentUtterance: body.studentUtterance,
      knowledgeLevel: level,
      personalization,
    });
    turn = result;
  } catch (e) {
    console.error("[mentored/turn]", e);
    return NextResponse.json(
      { error: "AI could not respond. Try again shortly." },
      { status: 502 }
    );
  }

  // Silently add to Focused Review if Claude flagged it.
  if (turn.addToFocusedReview) {
    try {
      await supabase.from("user_personal_quiz_items").insert({
        user_id: user.id,
        material_id: body.materialId,
        module_id: body.moduleId,
        item: {
          type: "free_response",
          question: body.chunk.checkQuestion,
          referenceAnswer: body.chunk.referenceAnswer,
          explanation: body.chunk.explanation,
        },
      });
    } catch (e) {
      // Non-fatal — student still sees the reply.
      console.error("[mentored/turn focused-review insert]", e);
    }
  }

  return NextResponse.json(turn);
}
