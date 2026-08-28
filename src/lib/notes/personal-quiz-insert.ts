import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingDbColumnError,
  isNotNullViolation,
  missingColumnFromError,
} from "@/lib/supabase/schema-compat";

/** Columns added by migration 106 — drop and retry if the DB is behind. */
export const PERSONAL_QUIZ_SOURCE_COLUMNS = [
  "source_note_id",
  "source_excerpt",
  "source_label",
] as const;

export const FOCUS_NOTES_MIGRATION_HINT =
  "Could not save questions. Apply database migration 106_personal_quiz_note_source.sql, then try again.";

export type PersonalQuizInsertRow = {
  user_id: string;
  material_id: string | null;
  module_id: number | null;
  item: unknown;
  source_note_id: string | null;
  source_excerpt: string;
  source_label: string;
};

export type PersonalQuizInserted = {
  id: string;
  item: unknown;
  created_at: string;
};

export function stripColumnFromRows(
  rows: Record<string, unknown>[],
  column: string
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!(column in row)) return row;
    const next = { ...row };
    delete next[column];
    return next;
  });
}

export function stripSourceColumns(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  let next = rows;
  for (const col of PERSONAL_QUIZ_SOURCE_COLUMNS) {
    next = stripColumnFromRows(next, col);
  }
  return next;
}

export type InsertPersonalQuizResult =
  | { ok: true; rows: PersonalQuizInserted[] }
  | { ok: false; needsMigration: boolean; message: string };

/**
 * Insert focus cards, retrying without migration-106 columns when the
 * schema cache / DB is behind. Notes-only rows (null material_id) still
 * need 106 for the NOT NULL drop.
 */
export async function insertPersonalQuizItems(
  supabase: SupabaseClient,
  rows: PersonalQuizInsertRow[]
): Promise<InsertPersonalQuizResult> {
  let payload: Record<string, unknown>[] = rows.map((r) => ({ ...r }));

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from("user_personal_quiz_items")
      .insert(payload as never)
      .select("id, item, created_at");

    if (!error) {
      return {
        ok: true,
        rows: (data ?? []) as PersonalQuizInserted[],
      };
    }

    if (
      isNotNullViolation(error, "material_id", "module_id") &&
      payload.some((r) => r.material_id == null || r.module_id == null)
    ) {
      console.error("[personal-quiz insert] needs migration 106", error);
      return {
        ok: false,
        needsMigration: true,
        message: FOCUS_NOTES_MIGRATION_HINT,
      };
    }

    const named = missingColumnFromError(error);
    if (named && payload.some((r) => named in r)) {
      payload = stripColumnFromRows(payload, named);
      continue;
    }

    if (
      isMissingDbColumnError(error, ...PERSONAL_QUIZ_SOURCE_COLUMNS) &&
      payload.some((r) =>
        PERSONAL_QUIZ_SOURCE_COLUMNS.some((c) => c in r)
      )
    ) {
      payload = stripSourceColumns(payload);
      continue;
    }

    console.error("[personal-quiz insert]", error);
    const msg = (error.message ?? "").toLowerCase();
    const needsMigration =
      isMissingDbColumnError(error, ...PERSONAL_QUIZ_SOURCE_COLUMNS) ||
      /source_note_id|source_excerpt|source_label|material_id/i.test(msg);
    return {
      ok: false,
      needsMigration,
      message: needsMigration
        ? FOCUS_NOTES_MIGRATION_HINT
        : "Could not save questions.",
    };
  }

  return {
    ok: false,
    needsMigration: true,
    message: FOCUS_NOTES_MIGRATION_HINT,
  };
}
