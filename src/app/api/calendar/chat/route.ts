import { NextResponse } from "next/server";
import { enterAiUsageContext } from "@/lib/billing/ai-usage";
import { runCalendarChat } from "@/lib/ai/calendar-chat";
import {
  coerceActionTimestamps,
  resolveCalendarItemId,
} from "@/lib/calendar/calendar-chat";
import {
  parseCalendarInput,
  parseCalendarPatch,
} from "@/lib/calendar/items";
import {
  insertCalendarItem,
  queryCalendarItems,
  queryCalendarSections,
  updateCalendarItem,
} from "@/lib/calendar/queries";
import { MAX_CHAT_PDF_CHARS } from "@/lib/live-notes/extract-chat-pdf";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

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
    attachedPdfText?: unknown;
    attachedPdfName?: unknown;
  };
  const attachedPdfText =
    typeof b.attachedPdfText === "string"
      ? b.attachedPdfText.trim().slice(0, MAX_CHAT_PDF_CHARS)
      : "";
  const attachedPdfName =
    typeof b.attachedPdfName === "string"
      ? b.attachedPdfName.trim().slice(0, 200)
      : "";
  const rawMessage = typeof b.message === "string" ? b.message.trim() : "";
  if (!rawMessage && !attachedPdfText) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  const message =
    rawMessage.slice(0, 4_000) ||
    `Look at this PDF${attachedPdfName ? ` (${attachedPdfName})` : ""}.`;

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

  const [{ items, error }, sections] = await Promise.all([
    queryCalendarItems(supabase, user.id, 200),
    queryCalendarSections(supabase, user.id),
  ]);

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
      sections,
      nowIso,
      timeZone,
      userId: user.id,
      attachedPdfText: attachedPdfText || undefined,
      attachedPdfName: attachedPdfName || undefined,
    });
    reply = result.reply;
    actions = result.actions.map((a) => coerceActionTimestamps(a, timeZone));
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
        const { item: created } = await insertCalendarItem(
          supabase,
          user.id,
          input
        );
        if (!created) continue;
        nextItems = [...nextItems, created];
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
          const { item: updated } = await updateCalendarItem(
            supabase,
            user.id,
            id,
            { completedAt }
          );
          if (!updated) continue;
          nextItems = nextItems.map((i) => (i.id === id ? updated : i));
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
          const { item: updated } = await updateCalendarItem(
            supabase,
            user.id,
            id,
            patch
          );
          if (!updated) continue;
          nextItems = nextItems.map((i) => (i.id === id ? updated : i));
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
