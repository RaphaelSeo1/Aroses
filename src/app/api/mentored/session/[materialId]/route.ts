import { NextResponse } from "next/server";
import { syncCourseProgressFromMaterial } from "@/lib/course-progress/sync-from-material";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type {
  MentoredAttemptState,
  MentoredHistoryEntry,
  MentoredLessonPlan,
  MentoredSessionPatch,
  MentoredSessionRecord,
  TutorMode,
  WhiteboardState,
} from "@/types/mentored";

/**
 * GET  /api/mentored/session/[materialId]
 *   Returns the active session (or null if none yet).
 *
 * PUT  /api/mentored/session/[materialId]
 *   Upsert partial session state. Body is `MentoredSessionPatch`.
 *   Pass `appendHistory` to append one entry to history atomically.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

const DEFAULT_ATTEMPT_STATE: MentoredAttemptState = {
  chunkIndex: 0,
  attempts: 0,
  lastEval: null,
};

function isTutorMode(v: unknown): v is TutorMode {
  return (
    v === "presenting" ||
    v === "paused" ||
    v === "answering" ||
    v === "resuming"
  );
}

function isWhiteboardState(v: unknown): v is WhiteboardState {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as WhiteboardState).actions)
  );
}

function normalize(row: {
  id: string;
  user_id: string;
  material_id: string;
  module_id: number;
  chunk_index: number;
  lesson_plan: MentoredLessonPlan | null;
  last_recap: string | null;
  attempt_state: MentoredAttemptState | Record<string, unknown>;
  history: MentoredHistoryEntry[] | unknown;
  tutor_mode?: string | null;
  whiteboard_state_json?: WhiteboardState | Record<string, unknown> | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}): MentoredSessionRecord {
  const wb = row.whiteboard_state_json;
  return {
    id: row.id,
    userId: row.user_id,
    materialId: row.material_id,
    moduleId: row.module_id,
    chunkIndex: row.chunk_index,
    lessonPlan: row.lesson_plan,
    lastRecap: row.last_recap,
    attemptState:
      isAttemptState(row.attempt_state)
        ? row.attempt_state
        : { ...DEFAULT_ATTEMPT_STATE },
    history: Array.isArray(row.history) ? (row.history as MentoredHistoryEntry[]) : [],
    tutorMode: isTutorMode(row.tutor_mode) ? row.tutor_mode : undefined,
    whiteboardState: isWhiteboardState(wb) ? wb : undefined,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isAttemptState(v: unknown): v is MentoredAttemptState {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MentoredAttemptState).chunkIndex === "number" &&
    typeof (v as MentoredAttemptState).attempts === "number"
  );
}

export async function GET(_request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("user_mentored_sessions")
    .select(
      "id, user_id, material_id, module_id, chunk_index, lesson_plan, last_recap, attempt_state, history, tutor_mode, whiteboard_state_json, last_seen_at, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    console.error("[mentored/session GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  return NextResponse.json({
    session: data ? normalize(data as Parameters<typeof normalize>[0]) : null,
  });
}

export async function PUT(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  let body: MentoredSessionPatch;
  try {
    body = (await request.json()) as MentoredSessionPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Read the existing row so we can append to history without races.
  const { data: existing } = await supabase
    .from("user_mentored_sessions")
    .select("id, history")
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  const now = new Date().toISOString();
  const baseHistory: MentoredHistoryEntry[] = Array.isArray(existing?.history)
    ? (existing!.history as MentoredHistoryEntry[])
    : [];
  const nextHistory = body.appendHistory
    ? [...baseHistory, body.appendHistory]
    : baseHistory;

  // Build the upsert payload — only set columns the client actually sent so
  // we don't clobber sibling state with partial patches.
  const update: Record<string, unknown> = {
    user_id: user.id,
    material_id: materialId,
    last_seen_at: now,
    updated_at: now,
  };
  if (typeof body.moduleId === "number") update.module_id = body.moduleId;
  if (typeof body.chunkIndex === "number") update.chunk_index = body.chunkIndex;
  if (body.lessonPlan !== undefined) update.lesson_plan = body.lessonPlan;
  if (body.lastRecap !== undefined) update.last_recap = body.lastRecap;
  if (body.attemptState !== undefined) update.attempt_state = body.attemptState;
  if (body.appendHistory) update.history = nextHistory;
  if (body.tutorMode !== undefined) update.tutor_mode = body.tutorMode;
  if (body.whiteboardState !== undefined) {
    update.whiteboard_state_json = body.whiteboardState;
  }

  const { data, error } = await supabase
    .from("user_mentored_sessions")
    .upsert(update, { onConflict: "user_id,material_id" })
    .select(
      "id, user_id, material_id, module_id, chunk_index, lesson_plan, last_recap, attempt_state, history, tutor_mode, whiteboard_state_json, last_seen_at, created_at, updated_at"
    )
    .maybeSingle();

  if (error || !data) {
    console.error("[mentored/session PUT]", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  const row = data as Parameters<typeof normalize>[0];
  // Free Exploration reuses this endpoint for module-only position writes.
  // Only stamp `last_mode: mentored` when the payload is clearly a mentored
  // session update — otherwise we clobber Free Exploration resume state.
  const isMentoredActivity =
    typeof body.chunkIndex === "number" ||
    body.lessonPlan !== undefined ||
    body.attemptState !== undefined ||
    body.lastRecap !== undefined ||
    body.appendHistory !== undefined ||
    body.whiteboardState !== undefined ||
    body.tutorMode !== undefined;

  await syncCourseProgressFromMaterial(supabase, user.id, materialId, {
    materialId,
    lastModuleId: row.module_id,
    ...(isMentoredActivity
      ? { lastChunkIndex: row.chunk_index, lastMode: "mentored" as const }
      : {}),
  });

  return NextResponse.json({
    session: normalize(row),
  });
}
