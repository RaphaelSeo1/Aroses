import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { synthesizeCanonicalLiveNotes } from "@/lib/ai/canonical-live-notes";
import { clampNoteInstruction } from "@/lib/ai/note-instruction";
import type { CanonicalDraftSection } from "@/lib/live-notes/canonical-synthesis";
import { loadCanonicalLiveNoteSources } from "@/lib/live-notes/source-bundle";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { report } from "@/lib/report-error";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ sessionId: string }> };

const MAX_SECTIONS = 200;
const MAX_DRAFT_CHARS = 100_000;
const MAX_ATTACHED_CHARS = 48_000;

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as {
    existingSections?: unknown;
    noteInstruction?: unknown;
    attachedFiles?: unknown;
  };

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_id, title, status, slides_page_count")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "failed") {
    return NextResponse.json({ error: "This session has ended." }, { status: 409 });
  }

  let draftChars = 0;
  const existingSections: CanonicalDraftSection[] = Array.isArray(
    b.existingSections
  )
    ? b.existingSections
        .filter(
          (section): section is {
            sectionId: string;
            markdown: string;
            studentEdited?: boolean;
          } =>
            !!section &&
            typeof section === "object" &&
            typeof (section as { sectionId?: unknown }).sectionId === "string" &&
            typeof (section as { markdown?: unknown }).markdown === "string"
        )
        .slice(0, MAX_SECTIONS)
        .flatMap((section) => {
          const remaining = MAX_DRAFT_CHARS - draftChars;
          if (remaining <= 0) return [];
          const markdown = section.markdown.slice(0, remaining);
          draftChars += markdown.length;
          return [
            {
              sectionId: section.sectionId.slice(0, 64),
              markdown,
              studentEdited: section.studentEdited === true,
            },
          ];
        })
    : [];

  const transientMaterials: Array<{ name: string; text: string }> = [];
  let attachedChars = 0;
  if (Array.isArray(b.attachedFiles)) {
    for (const item of b.attachedFiles.slice(0, 10)) {
      if (!item || typeof item !== "object") continue;
      const name =
        typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name.trim().slice(0, 200)
          : "Uploaded material";
      const raw =
        typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text.trim()
          : "";
      const remaining = MAX_ATTACHED_CHARS - attachedChars;
      if (!raw || remaining <= 0) continue;
      const text = raw.slice(0, remaining);
      attachedChars += text.length;
      transientMaterials.push({ name, text });
      const sourceHash = createHash("sha256")
        .update(`${name}\0${text}`)
        .digest("hex");
      try {
        const { error } = await supabase.from("live_lecture_note_sources").upsert(
          {
            session_id: sessionId,
            user_id: user.id,
            source_kind: "attachment",
            name,
            source_hash: sourceHash,
            extracted_text: text,
          },
          { onConflict: "session_id,source_hash", ignoreDuplicates: true }
        );
        if (error) {
          return NextResponse.json(
            {
              error: /schema cache|does not exist/i.test(error.message)
                ? "File-backed notes need database migration 111 before attachments can be reconciled safely."
                : "Could not save the attached file as a durable note source.",
            },
            { status: /schema cache|does not exist/i.test(error.message) ? 503 : 500 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Could not save the attached file as a durable note source." },
          { status: 500 }
        );
      }
    }
  }

  const noteInstruction =
    typeof b.noteInstruction === "string"
      ? clampNoteInstruction(b.noteInstruction)
      : clampNoteInstruction(
          await loadNoteInstruction(supabase, "live_lecture_sessions", {
            id: sessionId,
            user_id: user.id,
          })
        );

  try {
    const sources = await loadCanonicalLiveNoteSources(supabase, sessionId);
    const known = new Set(
      (sources.materials ?? []).map(
        (material) => `${material.name}\0${material.text}`
      )
    );
    sources.materials = [
      ...(sources.materials ?? []),
      ...transientMaterials.filter(
        (material) => !known.has(`${material.name}\0${material.text}`)
      ),
    ];
    if (
      sources.materials.reduce(
        (sum, material) => sum + material.text.length,
        0
      ) > 80_000
    ) {
      sources.complete = false;
      sources.incompleteReasons = [
        ...(sources.incompleteReasons ?? []),
        "uploaded material character limit exceeded",
      ];
    }
    if (sources.complete === false) {
      return NextResponse.json(
        {
          error:
            "The complete source set could not be loaded, so the existing notes were left unchanged.",
        },
        { status: 409 }
      );
    }
    const markdown = await synthesizeCanonicalLiveNotes({
      title:
        typeof session.title === "string" ? session.title : "Live lecture",
      sources,
      existingSections,
      noteInstruction: noteInstruction || undefined,
      userId: user.id,
    });
    if (!markdown) {
      return NextResponse.json(
        { error: "There is not enough source material to generate notes yet." },
        { status: 400 }
      );
    }

    const pageCount =
      typeof session.slides_page_count === "number"
        ? session.slides_page_count
        : 0;
    if (pageCount > 0) {
      await supabase
        .from("live_lecture_sessions")
        .update({
          slides_seeded_through_page: pageCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }
    return NextResponse.json({ markdown });
  } catch (error) {
    console.error("[live-notes/reconcile]", error);
    void report("live-notes.reconcile_failed", error, {
      userId: user.id,
      detail: { sessionId },
    });
    return NextResponse.json(
      { error: "Could not rebuild the notes from the available sources." },
      { status: 500 }
    );
  }
}
