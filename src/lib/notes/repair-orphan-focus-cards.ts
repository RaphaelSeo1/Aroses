import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "../supabase/schema-compat.ts";
import { focusCardText } from "./match-focus-note.ts";
import {
  loadNotesFocusOriginCatalog,
  remapPersonalFocusOriginRows,
} from "./focus-origin-catalog.ts";

export {
  pickNoteForFocusLabel,
  pickLiveSessionForFocusCard,
  pickSectionNoteForStoredLabel,
  resolveFocusCardNoteId,
  focusCardText,
  type FocusNoteMatch,
  type FocusSessionMatch,
  type LiveSessionMatchCandidate,
  type NoteMatchCandidate,
} from "./match-focus-note.ts";

/**
 * Previously ran on every Review GET and rewrote `user_personal_quiz_items`
 * (source_note_id, material_id) plus `user_notes.course_id` by lecture title.
 * That collapsed notes-hub Lecture 2/3 decks into course Lecture 3 and
 * renamed children to the course lecture title.
 *
 * Grouping is read-time now. This function must never UPDATE/DELETE quiz
 * rows or note titles — even if a caller reintroduces it on fetch.
 */
export async function repairOrphanNotesFocusCards(
  _supabase: SupabaseClient,
  _userId: string
): Promise<void> {
  void _supabase;
  void _userId;
}

/**
 * One-time write: put remapped notes-hub cards back on the hub note their
 * label / related course folder / note body still identifies. Never called
 * from Review GET.
 */
export async function applyHubFocusCardRestores(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const notes = await loadNotesFocusOriginCatalog(supabase, userId);
  const first = await supabase
    .from("user_personal_quiz_items")
    .select("id, source_note_id, source_label, source_excerpt, material_id, item")
    .eq("user_id", userId)
    .limit(2000);
  let rows = first.data;
  if (first.error && isMissingDbColumnError(first.error, "item")) {
    const fallback = await supabase
      .from("user_personal_quiz_items")
      .select("id, source_note_id, source_label, source_excerpt, material_id")
      .eq("user_id", userId)
      .limit(2000);
    if (fallback.error) {
      console.error("[applyHubFocusCardRestores load]", fallback.error);
      return 0;
    }
    rows = fallback.data;
  } else if (first.error) {
    console.error("[applyHubFocusCardRestores load]", first.error);
    return 0;
  }

  const list = rows ?? [];
  const remapped = remapPersonalFocusOriginRows(
    list.map((row) => ({
      materialId:
        typeof row.material_id === "string" ? row.material_id : null,
      sourceNoteId:
        typeof row.source_note_id === "string" ? row.source_note_id : null,
      sourceLabel:
        typeof row.source_label === "string" ? row.source_label : null,
      cardText: [
        typeof row.source_excerpt === "string" ? row.source_excerpt : "",
        focusCardText(row.item),
      ]
        .filter(Boolean)
        .join("\n"),
    })),
    notes
  );

  const titleById = new Map(notes.map((n) => [n.id, n.title]));
  let patched = 0;
  for (let i = 0; i < list.length; i++) {
    const row = list[i]!;
    const next = remapped[i]!;
    const current =
      typeof row.source_note_id === "string" ? row.source_note_id : null;
    if (!next.sourceNoteId || next.sourceNoteId === current) continue;
    const hubTitle = titleById.get(next.sourceNoteId)?.trim() || null;
    const patch: Record<string, unknown> = {
      source_note_id: next.sourceNoteId,
      material_id: null,
    };
    if (hubTitle) patch.source_label = hubTitle.slice(0, 200);
    const { error } = await supabase
      .from("user_personal_quiz_items")
      .update(patch)
      .eq("id", row.id)
      .eq("user_id", userId);
    if (error) {
      console.error("[applyHubFocusCardRestores patch]", row.id, error);
      continue;
    }
    patched += 1;
  }
  return patched;
}
