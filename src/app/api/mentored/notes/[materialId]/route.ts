import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

function apiAutoGenLog(step: string, payload?: Record<string, unknown>): void {
  if (payload !== undefined) {
    console.log(`AUTO-GENERATE: API ${step}`, payload);
  } else {
    console.log(`AUTO-GENERATE: API ${step}`);
  }
}

function apiAutoGenLogError(
  step: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
  console.error(`AUTO-GENERATE: API ${step}`, { error: err, ...extra });
}

/**
 * GET  /api/mentored/notes/[materialId]
 *   Returns the student's notes doc for this material (or a fresh
 *   empty doc when none has been written yet).
 *
 * PUT  /api/mentored/notes/[materialId]
 *   Upserts the notes doc. Body shape:
 *     { contentJson: <TipTap ProseMirror JSON>, contentText: string,
 *       autoGenerate?: boolean }
 *   We do a single round-trip per save with autosave debounced on the
 *   client so this is fine to call frequently.
 *
 * Schema invariants:
 *   - One row per (user, material). Enforced by the unique index from
 *     migration 034.
 *   - Plain-text mirror is trimmed + truncated to ~50_000 chars to
 *     guard against runaway notes.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

type NotesPayload = {
  contentJson: unknown;
  contentText: string;
  autoGenerate: boolean;
  updatedAt: string;
};

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function normalize(row: {
  content_json: unknown;
  content_text: string | null;
  auto_generate: boolean | null;
  updated_at: string;
}): NotesPayload {
  return {
    contentJson:
      row.content_json && typeof row.content_json === "object"
        ? row.content_json
        : EMPTY_DOC,
    contentText: row.content_text ?? "",
    autoGenerate: Boolean(row.auto_generate),
    updatedAt: row.updated_at,
  };
}

export async function GET(_req: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  apiAutoGenLog("GET /api/mentored/notes/[materialId] called", { materialId });
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
    .from("user_course_notes")
    .select("content_json, content_text, auto_generate, updated_at")
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    console.error("[mentored/notes GET]", error);
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }

  if (!data) {
    const empty = {
      contentJson: EMPTY_DOC,
      contentText: "",
      autoGenerate: false,
      updatedAt: new Date(0).toISOString(),
    } satisfies NotesPayload;
    apiAutoGenLog("returning response", { notes: empty });
    return NextResponse.json({ notes: empty });
  }

  const notes = normalize(data as Parameters<typeof normalize>[0]);
  apiAutoGenLog("returning response", {
    autoGenerate: notes.autoGenerate,
    contentTextLength: notes.contentText.length,
  });
  return NextResponse.json({ notes });
}

export async function PUT(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  let body: {
    contentJson?: unknown;
    contentText?: string;
    autoGenerate?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isAutoGenerateToggle = typeof body.autoGenerate === "boolean";
  apiAutoGenLog("PUT /api/mentored/notes/[materialId] called", {
    materialId,
    autoGenerate: body.autoGenerate,
    contentTextLength:
      typeof body.contentText === "string" ? body.contentText.length : null,
    isAutoGenerateToggle,
  });

  if (!body.contentJson || typeof body.contentJson !== "object") {
    return NextResponse.json({ error: "Missing contentJson." }, { status: 400 });
  }
  // Soft size guard — TipTap docs can balloon if the student pastes
  // gigantic content. 1.5 MB JSON cap.
  try {
    const size = JSON.stringify(body.contentJson).length;
    if (size > 1_500_000) {
      return NextResponse.json({ error: "Notes too large." }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid contentJson." }, { status: 400 });
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

  const text =
    typeof body.contentText === "string"
      ? body.contentText.slice(0, 50_000)
      : "";

  const update = {
    user_id: user.id,
    material_id: materialId,
    content_json: body.contentJson,
    content_text: text,
    auto_generate:
      typeof body.autoGenerate === "boolean" ? body.autoGenerate : undefined,
    updated_at: new Date().toISOString(),
  };
  // Drop undefined keys so the upsert doesn't overwrite an existing
  // autoGenerate value with NULL when the client just sent content.
  const cleaned = Object.fromEntries(
    Object.entries(update).filter(([, v]) => v !== undefined)
  );

  const { data, error } = await supabase
    .from("user_course_notes")
    .upsert(cleaned, { onConflict: "user_id,material_id" })
    .select("content_json, content_text, auto_generate, updated_at")
    .maybeSingle();

  if (error || !data) {
    apiAutoGenLogError("PUT failed", error, { materialId });
    console.error("[mentored/notes PUT]", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  const notes = normalize(data as Parameters<typeof normalize>[0]);
  apiAutoGenLog("returning response", {
    autoGenerate: notes.autoGenerate,
    contentTextLength: notes.contentText.length,
  });
  return NextResponse.json({ notes });
}
