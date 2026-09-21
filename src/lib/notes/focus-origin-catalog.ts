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
    notesText:
      typeof raw.content_text === "string" && raw.content_text.trim()
        ? raw.content_text
        : null,
  });
}

async function hydrateHubNoteText(
  supabase: SupabaseClient,
  userId: string,
  notes: NoteMatchCandidate[]
): Promise<void> {
  const hubIds = notes
    .filter((n) => n.sectionId && !n.deleted)
    .map((n) => n.id);
  if (hubIds.length === 0) return;
  const { data, error } = await supabase
    .from("user_notes")
    .select("id, content_text")
    .eq("user_id", userId)
    .in("id", hubIds);
  if (error && isMissingDbColumnError(error, "content_text")) return;
  if (error) {
    console.error("[loadNotesFocusOriginCatalog note text]", error);
    return;
  }
  const textById = new Map<string, string>();
  for (const row of data ?? []) {
    if (
      typeof row.id === "string" &&
      typeof row.content_text === "string" &&
      row.content_text.trim()
    ) {
      textById.set(row.id, row.content_text);
    }
  }
  for (const note of notes) {
    const text = textById.get(note.id);
    if (text) note.notesText = text;
  }
}

async function hydrateCatalogMeta(
  supabase: SupabaseClient,
  userId: string,
  notes: NoteMatchCandidate[]
): Promise<void> {
  const sectionIds = [
    ...new Set(
      notes
        .map((n) => n.sectionId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const courseIds = [
    ...new Set(
      notes
        .map((n) => n.courseId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (sectionIds.length > 0) {
    const { data, error } = await supabase
      .from("user_note_sections")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", sectionIds);
    if (error) {
      console.error("[loadNotesFocusOriginCatalog sections]", error);
    } else {
      const titles = new Map<string, string>();
      for (const row of data ?? []) {
        if (typeof row.id === "string" && typeof row.title === "string") {
          titles.set(row.id, row.title);
        }
      }
      for (const note of notes) {
        if (note.sectionId) {
          note.sectionTitle = titles.get(note.sectionId) ?? null;
        }
      }
    }
  }
  if (courseIds.length > 0) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, title")
      .in("id", courseIds);
    if (error) {
      console.error("[loadNotesFocusOriginCatalog courses]", error);
    } else {
      const titles = new Map<string, string>();
      for (const row of data ?? []) {
        if (typeof row.id === "string" && typeof row.title === "string") {
          titles.set(row.id, row.title);
        }
      }
      for (const note of notes) {
        if (note.courseId) {
          note.courseTitle = titles.get(note.courseId) ?? null;
        }
      }
    }
  }
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
  let loaded = first;
  if (first.error && isMissingDbColumnError(first.error, "section_id")) {
    return notes;
  }
  if (loaded.error && isMissingDbColumnError(loaded.error, "deleted_at")) {
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
    await hydrateCatalogMeta(supabase, userId, notes);
    await hydrateHubNoteText(supabase, userId, notes);
    return notes;
  }
  if (loaded.error) {
    console.error("[loadNotesFocusOriginCatalog]", loaded.error);
    return notes;
  }
  for (const raw of loaded.data ?? []) {
    pushNote(notes, raw as Record<string, unknown>);
  }
  await hydrateCatalogMeta(supabase, userId, notes);
  await hydrateHubNoteText(supabase, userId, notes);
  return notes;
}

export type PersonalFocusOriginRow = {
  materialId?: string | null;
  sourceNoteId?: string | null;
  sourceLabel?: string | null;
  cardText?: string | null;
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
      notes,
      { cardText: row.cardText, materialId: row.materialId }
    ),
  }));
}
