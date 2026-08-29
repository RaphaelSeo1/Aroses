import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALENDAR_SELECT,
  CALENDAR_SELECT_BASE,
  mapCalendarRow,
  toInsertRow,
  toPatchRow,
} from "@/lib/calendar/items";
import {
  CALENDAR_SECTIONS_MAX,
  CALENDAR_SECTIONS_SELECT,
  mapSectionRow,
} from "@/lib/calendar/sections";
import {
  encodeTodoSectionFallbackNotes,
  isTodoSectionFallbackNotes,
  parseTodoSectionFallbackNotes,
  splitTodoSectionFallback,
} from "@/lib/calendar/todo-section-fallback";
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
  if (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "PGRST204"
  ) {
    return true;
  }
  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes(tableHint.toLowerCase()) ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
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
): Promise<{ sections: CalendarTodoSection[]; tableMissing: boolean }> {
  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .select(CALENDAR_SECTIONS_SELECT)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelation(error, "user_calendar_todo_sections")) {
      return { sections: [], tableMissing: true };
    }
    console.error("[calendar sections]", error);
    return { sections: [], tableMissing: false };
  }
  return {
    sections: (data ?? []).map((row) =>
      mapSectionRow(row as Parameters<typeof mapSectionRow>[0])
    ),
    tableMissing: false,
  };
}

export async function loadUserCalendar(
  supabase: SupabaseClient,
  userId: string,
  limit = 400
): Promise<{
  items: CalendarItem[];
  sections: CalendarTodoSection[];
  tableMissing: boolean;
  error: { code?: string; message?: string } | null;
}> {
  const [{ items, error }, sectionResult] = await Promise.all([
    queryCalendarItems(supabase, userId, limit),
    queryCalendarSections(supabase, userId),
  ]);
  if (error) {
    return {
      items: [],
      sections: [],
      tableMissing: sectionResult.tableMissing,
      error,
    };
  }
  const split = splitTodoSectionFallback(items);
  return {
    items: split.items,
    sections:
      sectionResult.sections.length > 0
        ? sectionResult.sections
        : split.sections,
    tableMissing: sectionResult.tableMissing,
    error: null,
  };
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
    if (!isMissingRelation(error, "user_calendar_todo_sections")) return null;
  } else if (data?.id) {
    return data.id;
  }

  const { data: row } = await supabase
    .from("user_calendar_items")
    .select("id, notes")
    .eq("id", sectionId)
    .eq("user_id", userId)
    .maybeSingle();
  const notes = typeof row?.notes === "string" ? row.notes : "";
  if (row?.id && isTodoSectionFallbackNotes(notes)) return row.id;
  return null;
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
    const item = mapRow(retry.data);
    if (input.sectionId && !item.sectionId) {
      await syncFallbackItemSection(
        supabase,
        userId,
        item.id,
        input.sectionId
      );
      return { item: { ...item, sectionId: input.sectionId }, error: null };
    }
    return { item, error: null };
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
    const item = mapRow(retry.data);
    if (patch.sectionId !== undefined) {
      await syncFallbackItemSection(
        supabase,
        userId,
        itemId,
        patch.sectionId
      );
      return { item: { ...item, sectionId: patch.sectionId }, error: null };
    }
    const overlay = await overlayFallbackSectionId(supabase, userId, item);
    return { item: overlay, error: null };
  }

  if (full.error) return { item: null, error: full.error };
  if (!full.data) return { item: null, error: null };
  return { item: mapRow(full.data), error: null };
}

async function overlayFallbackSectionId(
  supabase: SupabaseClient,
  userId: string,
  item: CalendarItem
): Promise<CalendarItem> {
  if (item.sectionId) return item;
  const { items } = await queryCalendarItems(supabase, userId);
  const { items: overlaid } = splitTodoSectionFallback(items);
  return overlaid.find((row) => row.id === item.id) ?? item;
}

async function syncFallbackItemSection(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  sectionId: string | null
): Promise<void> {
  const { items } = await queryCalendarItems(supabase, userId);
  for (const row of items) {
    const parsed = parseTodoSectionFallbackNotes(row.notes);
    if (!parsed) continue;
    const shouldHave = row.id === sectionId;
    const has = parsed.itemIds.includes(itemId);
    if (shouldHave === has) continue;
    const itemIds = shouldHave
      ? [...parsed.itemIds, itemId]
      : parsed.itemIds.filter((id) => id !== itemId);
    await supabase
      .from("user_calendar_items")
      .update({
        notes: encodeTodoSectionFallbackNotes({
          sortOrder: parsed.sortOrder,
          itemIds,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", userId);
  }
}

export async function insertTodoSection(
  supabase: SupabaseClient,
  userId: string,
  title: string
): Promise<{
  section: CalendarTodoSection | null;
  error: { code?: string; message?: string } | null;
  tooMany?: boolean;
}> {
  const dedicated = await insertDedicatedTodoSection(supabase, userId, title);
  if (dedicated.section || dedicated.tooMany) return dedicated;
  if (dedicated.error && !isMissingRelation(dedicated.error, "user_calendar_todo_sections")) {
    /* table exists but insert failed — still try the items fallback */
  }
  return insertFallbackTodoSection(supabase, userId, title);
}

async function insertDedicatedTodoSection(
  supabase: SupabaseClient,
  userId: string,
  title: string
): Promise<{
  section: CalendarTodoSection | null;
  error: { code?: string; message?: string } | null;
  tooMany?: boolean;
}> {
  const { count, error: countErr } = await supabase
    .from("user_calendar_todo_sections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countErr) {
    return { section: null, error: countErr };
  }
  if ((count ?? 0) >= CALENDAR_SECTIONS_MAX) {
    return { section: null, error: null, tooMany: true };
  }

  const { data: maxRow } = await supabase
    .from("user_calendar_todo_sections")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder =
    typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .insert({
      user_id: userId,
      title,
      sort_order: sortOrder,
    })
    .select(CALENDAR_SECTIONS_SELECT)
    .single();

  if (error || !data) return { section: null, error };
  return {
    section: mapSectionRow(data as Parameters<typeof mapSectionRow>[0]),
    error: null,
  };
}

async function insertFallbackTodoSection(
  supabase: SupabaseClient,
  userId: string,
  title: string
): Promise<{
  section: CalendarTodoSection | null;
  error: { code?: string; message?: string } | null;
  tooMany?: boolean;
}> {
  const listed = await supabase
    .from("user_calendar_items")
    .select(CALENDAR_SELECT_BASE)
    .eq("user_id", userId)
    .limit(400);
  if (listed.error) return { section: null, error: listed.error };
  const items = (listed.data ?? []).map((row) =>
    mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0])
  );
  const { sections } = splitTodoSectionFallback(items);
  if (sections.length >= CALENDAR_SECTIONS_MAX) {
    return { section: null, error: null, tooMany: true };
  }
  const sortOrder =
    sections.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

  const { data, error } = await supabase
    .from("user_calendar_items")
    .insert({
      user_id: userId,
      title,
      notes: encodeTodoSectionFallbackNotes({ sortOrder, itemIds: [] }),
      kind: "todo",
      starts_at: null,
      ends_at: null,
      all_day: true,
      important: false,
      completed_at: null,
    })
    .select(CALENDAR_SELECT_BASE)
    .single();

  if (error || !data) return { section: null, error };
  const item = mapCalendarRow(data as Parameters<typeof mapCalendarRow>[0]);
  return {
    section: {
      id: item.id,
      title: item.title,
      sortOrder,
      createdAt: item.createdAt,
    },
    error: null,
  };
}

export async function updateTodoSectionTitle(
  supabase: SupabaseClient,
  userId: string,
  sectionId: string,
  title: string
): Promise<{
  section: CalendarTodoSection | null;
  error: { code?: string; message?: string } | null;
}> {
  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", sectionId)
    .eq("user_id", userId)
    .select(CALENDAR_SECTIONS_SELECT)
    .maybeSingle();

  if (!error && data) {
    return {
      section: mapSectionRow(data as Parameters<typeof mapSectionRow>[0]),
      error: null,
    };
  }
  if (error && !isMissingRelation(error, "user_calendar_todo_sections")) {
    return { section: null, error };
  }

  const { data: row, error: rowErr } = await supabase
    .from("user_calendar_items")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", sectionId)
    .eq("user_id", userId)
    .select(CALENDAR_SELECT_BASE)
    .maybeSingle();
  if (rowErr) return { section: null, error: rowErr };
  const notes = typeof row?.notes === "string" ? row.notes : "";
  if (!row || !isTodoSectionFallbackNotes(notes)) {
    return { section: null, error: error ?? null };
  }
  const parsed = parseTodoSectionFallbackNotes(notes);
  const item = mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0]);
  return {
    section: {
      id: item.id,
      title: item.title,
      sortOrder: parsed?.sortOrder ?? 0,
      createdAt: item.createdAt,
    },
    error: null,
  };
}

export async function deleteTodoSection(
  supabase: SupabaseClient,
  userId: string,
  sectionId: string
): Promise<{ ok: boolean; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase
    .from("user_calendar_todo_sections")
    .delete()
    .eq("id", sectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (!error && data) return { ok: true, error: null };
  if (error && !isMissingRelation(error, "user_calendar_todo_sections")) {
    return { ok: false, error };
  }

  const { data: row } = await supabase
    .from("user_calendar_items")
    .select("id, notes")
    .eq("id", sectionId)
    .eq("user_id", userId)
    .maybeSingle();
  const notes = typeof row?.notes === "string" ? row.notes : "";
  if (!row?.id || !isTodoSectionFallbackNotes(notes)) {
    return { ok: false, error: error ?? null };
  }
  const del = await supabase
    .from("user_calendar_items")
    .delete()
    .eq("id", sectionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (del.error) return { ok: false, error: del.error };
  return { ok: Boolean(del.data), error: null };
}
