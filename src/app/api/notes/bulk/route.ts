import { NextResponse } from "next/server";
import {
  cardKeyForRef,
  parseNoteFolders,
  type NoteHubRef,
} from "@/lib/notes/hub-types";
import { createClient } from "@/lib/supabase/server";

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
    default:
      return { ok: false };
  }
}

async function loadNoteFolders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("user_notes_hub_layout")
    .select("note_folders")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (/note_folders/i.test(error.message ?? "")) return {};
    console.error("[notes bulk note_folders]", error);
    return {};
  }
  return parseNoteFolders(data?.note_folders);
}

async function saveNoteFolders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  folders: Record<string, string>
): Promise<boolean> {
  const { error } = await supabase.from("user_notes_hub_layout").upsert(
    {
      user_id: userId,
      note_folders: folders,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    // Don't fail the whole move if migration 090 isn't applied yet —
    // standalone section_id updates still succeed.
    if (/note_folders/i.test(error.message ?? "")) return false;
    console.error("[notes bulk save note_folders]", error);
    return false;
  }
  return true;
}

/** POST /api/notes/bulk — delete or move selected notes from the hub. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown; items?: unknown; sectionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "move") {
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

    let sectionId: string | null = null;
    if (body.sectionId === null) {
      sectionId = null;
    } else if (typeof body.sectionId === "string" && body.sectionId.trim()) {
      sectionId = body.sectionId.trim();
      const { data: section } = await supabase
        .from("user_note_sections")
        .select("id")
        .eq("id", sectionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!section) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
    } else if (body.sectionId !== undefined) {
      return NextResponse.json({ error: "Invalid sectionId" }, { status: 400 });
    }

    const folders = await loadNoteFolders(supabase, user.id);
    let moved = 0;

    for (const item of items) {
      const key = cardKeyForRef(item);
      let ok = true;

      if (item.kind === "standalone") {
        const { error } = await supabase
          .from("user_notes")
          .update({
            section_id: sectionId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id)
          .eq("user_id", user.id);
        if (error) ok = false;
      }

      if (ok) {
        if (sectionId) folders[key] = sectionId;
        else delete folders[key];
        moved += 1;
      }
    }

    await saveNoteFolders(supabase, user.id, folders);
    return NextResponse.json({ moved, sectionId });
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
  const folders = await loadNoteFolders(supabase, user.id);
  let foldersDirty = false;
  for (const item of items) {
    const result = await deleteHubItem(supabase, user.id, item);
    if (result.ok) {
      deleted += 1;
      const key = cardKeyForRef(item);
      if (key in folders) {
        delete folders[key];
        foldersDirty = true;
      }
    }
  }
  if (foldersDirty) await saveNoteFolders(supabase, user.id, folders);

  return NextResponse.json({ deleted });
}
