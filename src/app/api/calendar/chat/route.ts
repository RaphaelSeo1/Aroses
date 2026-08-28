import { NextResponse } from "next/server";
import { enterAiUsageContext } from "@/lib/billing/ai-usage";
import { runCalendarChat } from "@/lib/ai/calendar-chat";
import { resolveCalendarItemId } from "@/lib/calendar/calendar-chat";
import {
  CALENDAR_SELECT,
  mapCalendarRow,
  parseCalendarInput,
  parseCalendarPatch,
  toInsertRow,
  toPatchRow,
} from "@/lib/calendar/items";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import type { CalendarItem } from "@/types/calendar";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_HISTORY = 12;

/**
 * POST /api/calendar/chat — Rose reads the calendar and may emit create /
 * complete / delete / update actions which this route applies.
 */
export async function POST(request: Request) {
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
    message?: unknown;
    history?: unknown;
    timeZone?: unknown;
    nowIso?: unknown;
  };
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const history = Array.isArray(b.history)
    ? b.history
        .filter(
          (
            t
          ): t is { role: "user" | "assistant"; content: string } =>
            !!t &&
            typeof t === "object" &&
            ((t as { role?: unknown }).role === "user" ||
              (t as { role?: unknown }).role === "assistant") &&
            typeof (t as { content?: unknown }).content === "string"
        )
        .slice(-MAX_HISTORY)
        .map((t) => ({
          role: t.role,
          content: t.content.slice(0, 4_000),
        }))
    : [];

  const { data, error } = await supabase
    .from("user_calendar_items")
    .select(CALENDAR_SELECT)
    .eq("user_id", user.id)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    if (
      error.code === "42P01" ||
      /user_calendar_items/i.test(error.message ?? "")
    ) {
      return NextResponse.json({
        reply:
          "Your calendar is not set up yet. Ask to add something again after setup, or add a task yourself.",
        applied: [],
        items: [],
      });
    }
    console.error("[calendar/chat load]", error);
    return NextResponse.json(
      { error: "Could not load calendar." },
      { status: 500 }
    );
  }

  const items: CalendarItem[] = (data ?? []).map((row) =>
    mapCalendarRow(row as Parameters<typeof mapCalendarRow>[0])
  );

  enterAiUsageContext({ userId: user.id, feature: "calendar-chat" });

  const timeZone =
    typeof b.timeZone === "string" && b.timeZone.trim()
      ? b.timeZone.trim().slice(0, 80)
      : "UTC";
  const nowIso =
    typeof b.nowIso === "string" && !Number.isNaN(new Date(b.nowIso).getTime())
      ? b.nowIso
      : new Date().toISOString();

  let reply: string;
  let actions;
  try {
    const result = await runCalendarChat({
      message,
      history,
      items,
      nowIso,
      timeZone,
      userId: user.id,
    });
    reply = result.reply;
    actions = result.actions;
  } catch (e) {
    console.error("[calendar/chat]", e);
    return NextResponse.json(
      { error: "Could not answer just now. Try again." },
      { status: 500 }
    );
  }

  const applied: string[] = [];
  let nextItems = items;

  for (const action of actions) {
    try {
      if (action.type === "create") {
        const input = parseCalendarInput({
          title: action.title,
          kind: action.kind,
          startsAt: action.startsAt,
          endsAt: action.endsAt,
          allDay: action.allDay,
          important: action.important,
          notes: action.notes,
        });
        if (!input) continue;
        const { data: created, error: insErr } = await supabase
          .from("user_calendar_items")
          .insert(toInsertRow(user.id, input))
          .select(CALENDAR_SELECT)
          .single();
        if (insErr || !created) continue;
        const mapped = mapCalendarRow(
          created as Parameters<typeof mapCalendarRow>[0]
        );
        nextItems = [...nextItems, mapped];
        applied.push("create");
      } else {
        const id = resolveCalendarItemId(action.id, nextItems);
        if (!id) continue;
        if (action.type === "delete") {
          const { error: delErr } = await supabase
            .from("user_calendar_items")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id);
          if (delErr) continue;
          nextItems = nextItems.filter((i) => i.id !== id);
          applied.push("delete");
        } else if (action.type === "complete" || action.type === "uncomplete") {
          const completedAt =
            action.type === "complete" ? new Date().toISOString() : null;
          const { data: updated, error: upErr } = await supabase
            .from("user_calendar_items")
            .update(toPatchRow({ completedAt }))
            .eq("id", id)
            .eq("user_id", user.id)
            .select(CALENDAR_SELECT)
            .maybeSingle();
          if (upErr || !updated) continue;
          const mapped = mapCalendarRow(
            updated as Parameters<typeof mapCalendarRow>[0]
          );
          nextItems = nextItems.map((i) => (i.id === id ? mapped : i));
          applied.push(action.type);
        } else if (action.type === "update") {
          const patch = parseCalendarPatch({
            title: action.title,
            kind: action.kind,
            startsAt: action.startsAt,
            endsAt: action.endsAt,
            allDay: action.allDay,
            important: action.important,
            notes: action.notes,
          });
          if (!patch || Object.keys(patch).length === 0) continue;
          const { data: updated, error: upErr } = await supabase
            .from("user_calendar_items")
            .update(toPatchRow(patch))
            .eq("id", id)
            .eq("user_id", user.id)
            .select(CALENDAR_SELECT)
            .maybeSingle();
          if (upErr || !updated) continue;
          const mapped = mapCalendarRow(
            updated as Parameters<typeof mapCalendarRow>[0]
          );
          nextItems = nextItems.map((i) => (i.id === id ? mapped : i));
          applied.push("update");
        }
      }
    } catch {
      /* skip one failed action */
    }
  }

  return NextResponse.json({
    reply: reply || "Updated your calendar.",
    applied,
    items: nextItems,
  });
}
