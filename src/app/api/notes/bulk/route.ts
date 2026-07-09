import { NextResponse } from "next/server";
import type { NoteHubRef } from "@/lib/notes/hub-types";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

const MAX_BULK = 25;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRef(raw: unknown): NoteHubRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "standalone" && typeof o.id === "string" && UUID_RE.test(o.id)) {
    return { kind: "standalone", id: o.id };
  }
  if (kind === "tutor" && typeof o.id === "string" && UUID_RE.test(o.id)) {
    return { kind: "tutor", id: o.id };
  }
  if (kind === "live" && typeof o.id === "string" && UUID_RE.test(o.id)) {
    return { kind: "live", id: o.id };
  }
  if (
    kind === "course" &&
    typeof o.materialId === "string" &&
    UUID_RE.test(o.materialId)
  ) {
    return { kind: "course", materialId: o.materialId };
  }
  if (
    kind === "lesson" &&
    typeof o.materialId === "string" &&
    UUID_RE.test(o.materialId)
  ) {
    return { kind: "lesson", materialId: o.materialId };
  }
  return null;
}

async function deleteHubItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  item: NoteHubRef
): Promise<{ ok: boolean; reason?: string }> {
  switch (item.kind) {
    case "standalone": {
      const { error } = await supabase
        .from("user_notes")
        .delete()
        .eq("id", item.id)
        .eq("user_id", userId);
      return { ok: !error };
    }
    case "tutor": {
      const { error } = await supabase
        .from("tutor_sessions")
        .delete()
        .eq("id", item.id)
        .eq("user_id", userId);
      return { ok: !error };
    }
    case "live": {
      const { data: session } = await supabase
        .from("live_lecture_sessions")
        .select("status")
        .eq("id", item.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!session) return { ok: false, reason: "not_found" };
      if (session.status === "recording" || session.status === "paused") {
        return { ok: false, reason: "live_active" };
      }
      const { error } = await supabase
        .from("live_lecture_sessions")
        .delete()
        .eq("id", item.id)
        .eq("user_id", userId);
      return { ok: !error };
    }
    case "course": {
      const { error } = await supabase
        .from("user_course_notes")
        .delete()
        .eq("material_id", item.materialId)
        .eq("user_id", userId);
      return { ok: !error };
    }
    case "lesson": {
      const { error } = await supabase
        .from("user_lesson_notes")
        .delete()
        .eq("material_id", item.materialId)
        .eq("user_id", userId);
      return { ok: !error };
    }
    default:
      return { ok: false };
  }
}

/** POST /api/notes/bulk — delete selected notes from the hub. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown; items?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "delete") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Select at least one note." },
      { status: 400 }
    );
  }

  const items = body.items
    .map(parseRef)
    .filter((r): r is NoteHubRef => r !== null)
    .slice(0, MAX_BULK);

  if (items.length === 0) {
    return NextResponse.json({ error: "Invalid selection." }, { status: 400 });
  }

  let deleted = 0;
  let skippedLive = 0;
  for (const item of items) {
    const result = await deleteHubItem(supabase, user.id, item);
    if (result.ok) deleted += 1;
    else if (result.reason === "live_active") skippedLive += 1;
  }

  return NextResponse.json({ deleted, skippedLive });
}
