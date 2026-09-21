import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDbColumnError } from "../supabase/schema-compat.ts";
import { isUuid } from "../voice-tutor/uuid.ts";
import {
  resolveFocusCardNoteId,
  type NoteMatchCandidate,
} from "./match-focus-note.ts";

function asId(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value : null;
}

function pushNote(
  notes: NoteMatchCandidate[],
  raw: Record<string, unknown>,
  opts?: { deleted?: boolean }
): void {
  const id = asId(raw.id);
  if (!id) return;
  notes.push({
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    courseId: asId(raw.course_id),
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
    deleted: opts?.deleted ?? Boolean(raw.deleted_at),
    sectionId: asId(raw.section_id),
  });
}

/**
 * Notes used to group Review cards. Read-only — never patch titles or ids.
 */
export async function loadNotesFocusOriginCatalog(
  supabase: SupabaseClient,
  userId: string
): Promise<NoteMatchCandidate[]> {
  const notes: NoteMatchCandidate[] = [];
  const first = await supabase
    .from("user_notes")
    .select("id, title, course_id, updated_at, deleted_at, section_id")
    .eq("user_id", userId)
    .limit(400);
  if (first.error && isMissingDbColumnError(first.error, "section_id")) {
    return notes;
  }
  if (first.error && isMissingDbColumnError(first.error, "deleted_at")) {
    const fallback = await supabase
      .from("user_notes")
      .select("id, title, course_id, updated_at, section_id")
      .eq("user_id", userId)
      .limit(400);
    if (fallback.error) {
      console.error("[loadNotesFocusOriginCatalog]", fallback.error);
      return notes;
    }
    for (const raw of fallback.data ?? []) {
      pushNote(notes, raw as Record<string, unknown>, { deleted: false });
    }
    return notes;
  }
  if (first.error) {
    console.error("[loadNotesFocusOriginCatalog]", first.error);
    return notes;
  }
  for (const raw of first.data ?? []) {
    pushNote(notes, raw as Record<string, unknown>);
  }
  return notes;
}

export type PersonalFocusOriginRow = {
  materialId?: string | null;
  sourceNoteId?: string | null;
  sourceLabel?: string | null;
};

/** Remap stored note ids in memory. Does not UPDATE quiz rows. */
export function remapPersonalFocusOriginRows(
  rows: PersonalFocusOriginRow[],
  notes: NoteMatchCandidate[]
): Array<{
  materialId: string | null;
  sourceNoteId: string | null;
  sourceLabel: string | null;
}> {
  return rows.map((row) => ({
    materialId: row.materialId ?? null,
    sourceLabel: row.sourceLabel ?? null,
    sourceNoteId: resolveFocusCardNoteId(
      row.sourceNoteId ?? null,
      row.sourceLabel ?? null,
      notes
    ),
  }));
}
