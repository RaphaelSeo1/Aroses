import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALENDAR_SELECT,
  CALENDAR_SELECT_BASE,
  mapCalendarRow,
  toInsertRow,
  toPatchRow,
} from "@/lib/calendar/items";
import {
  CALENDAR_SECTIONS_SELECT,
  mapSectionRow,
} from "@/lib/calendar/sections";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import type {
  CalendarItem,
  CalendarItemInput,
  CalendarTodoSection,
} from "@/types/calendar";

function isMissingRelation(
  err: { code?: string; message?: string } | null | undefined,
  tableHint: string
): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return (err.message ?? "").toLowerCase().includes(tableHint.toLowerCase());
}

export async function queryCalendarItems(
  supabase: SupabaseClient,
  userId: string,
  limit = 400
): Promise<{ items: CalendarItem[]; error: { code?: string; message?: string } | null }> {
  const full = await supabase
    .from("user_calendar_items")
    .select(CALENDAR_SELECT)
    .eq("user_id", userId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (full.error && isMissingDbColumnError(full.error, "section_id")) {
    const fallback = await supabase
      .from("user_calendar_items")
      .select(CALENDAR_SELECT_BASE)
      .eq("user_id", userId)
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (fallback.error) return { items: [], error: fallback.error };
    return {
      items: (fallback.data ?? []).map((row) =>
        mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0])
      ),
      error: null,
    };
  }

  if (full.error) return { items: [], error: full.error };
  return {
    items: (full.data ?? []).map((row) =>
      mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0])
    ),
    error: null,
  };
}

export async function queryCalendarSections(
  supabase: SupabaseClient,
  userId: string
): Promise<CalendarTodoSection[]> {
  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .select(CALENDAR_SECTIONS_SELECT)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelation(error, "user_calendar_todo_sections")) return [];
    console.error("[calendar sections]", error);
    return [];
  }
  return (data ?? []).map((row) =>
    mapSectionRow(row as Parameters<typeof mapSectionRow>[0])
  );
}

export async function ownedSectionId(
  supabase: SupabaseClient,
  userId: string,
  sectionId: string | null | undefined
): Promise<string | null | undefined> {
  if (sectionId === undefined) return undefined;
  if (sectionId === null) return null;
  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error, "user_calendar_todo_sections")) return null;
    return null;
  }
  return data?.id ?? null;
}

function mapRow(data: unknown): CalendarItem {
  return mapCalendarRow(data as Parameters<typeof mapCalendarRow>[0]);
}

export async function insertCalendarItem(
  supabase: SupabaseClient,
  userId: string,
  input: CalendarItemInput
): Promise<{
  item: CalendarItem | null;
  error: { code?: string; message?: string } | null;
}> {
  const row = toInsertRow(userId, input);
  const full = await supabase
    .from("user_calendar_items")
    .insert(row)
    .select(CALENDAR_SELECT)
    .single();

  if (full.error && isMissingDbColumnError(full.error, "section_id")) {
    const { section_id: _sectionId, ...rest } = row;
    const retry = await supabase
      .from("user_calendar_items")
      .insert(rest)
      .select(CALENDAR_SELECT_BASE)
      .single();
    if (retry.error || !retry.data) return { item: null, error: retry.error };
    return { item: mapRow(retry.data), error: null };
  }

  if (full.error || !full.data) return { item: null, error: full.error };
  return { item: mapRow(full.data), error: null };
}

export async function updateCalendarItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  patch: Partial<CalendarItemInput>
): Promise<{
  item: CalendarItem | null;
  error: { code?: string; message?: string } | null;
}> {
  const row = toPatchRow(patch);
  const full = await supabase
    .from("user_calendar_items")
    .update(row)
    .eq("id", itemId)
    .eq("user_id", userId)
    .select(CALENDAR_SELECT)
    .maybeSingle();

  if (full.error && isMissingDbColumnError(full.error, "section_id")) {
    const { section_id: _sectionId, ...rest } = row;
    const retry = await supabase
      .from("user_calendar_items")
      .update(rest)
      .eq("id", itemId)
      .eq("user_id", userId)
      .select(CALENDAR_SELECT_BASE)
      .maybeSingle();
    if (retry.error) return { item: null, error: retry.error };
    if (!retry.data) return { item: null, error: null };
    return { item: mapRow(retry.data), error: null };
  }

  if (full.error) return { item: null, error: full.error };
  if (!full.data) return { item: null, error: null };
  return { item: mapRow(full.data), error: null };
}
