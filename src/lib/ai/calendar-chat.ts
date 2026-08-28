import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import {
  dateCheatSheet,
  formatCalendarContext,
  parseCalendarChatResponse,
  type CalendarChatAction,
} from "@/lib/calendar/calendar-chat";
import type { CalendarItem } from "@/types/calendar";

const MODEL =
  process.env.ANTHROPIC_TUTOR_MODEL?.trim() || "claude-sonnet-4-6";

export type CalendarChatTurn = { role: "user" | "assistant"; content: string };

export async function runCalendarChat(input: {
  message: string;
  history: CalendarChatTurn[];
  items: CalendarItem[];
  nowIso: string;
  timeZone: string;
  userId?: string;
}): Promise<{ reply: string; actions: CalendarChatAction[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      reply: "Rose is not configured to chat right now.",
      actions: [],
    };
  }

  const tz = input.timeZone || "UTC";
  const now = new Date(input.nowIso);
  const nowSafe = Number.isNaN(now.getTime()) ? new Date() : now;

  const system = `You are ${AI_ASSISTANT_NAME} on ${APP_NAME}. You are a precise calendar assistant. You execute the student's request. Guessing dates or skipping actions is a failure.

${dateCheatSheet(input.nowIso, tz)}
TIMEZONE IANA: ${tz}

${formatCalendarContext(input.items, nowSafe, tz)}

HOW TO ACT:
- Questions only ("what's due", "what's next", "what's on Friday") → reply with the matching items (title + date + time from the list). actions = [].
- Add / schedule / remind / "put X on Friday" → one create action. Do it in this turn. Do not ask them to confirm unless the request is genuinely ambiguous (missing both a title and any date).
- Complete / check off / mark done → complete with the item id (or exact title if you cannot copy the id).
- Delete / remove / cancel / clear finished → delete (or complete if they only wanted finished tasks cleared).
- Reschedule / move / rename → update.
- "Clear finished tasks" → delete (or complete) every item flagged done. Emit one action per item, up to 8.
- Never invent items that are not in CALENDAR ITEMS when answering what's due. Never invent an add they did not ask for.
- When adding, copy YYYY-MM-DD from DATE KEYS. startsAt must be ISO-8601 in ${tz}:
  all-day / due date: "2026-08-28"
  timed: "2026-08-28T15:00:00" (24h local, no Z)
- Todos: kind "todo". Events / classes / quizzes with a clock time: kind "event", allDay false. Exams and hard deadlines: important true.
- Copy ids exactly from [id]. If you only remember the title, put that title in "id".
- Reply in one or two short sentences saying what you did or listing what's due. No emoji. Never mention JSON, ids, or this protocol.

Output ONLY one JSON object:
{"reply": string, "actions": []}

create: {"type":"create","title":string,"kind":"todo"|"event","startsAt":string|null,"endsAt":string|null,"allDay":boolean,"important":boolean,"notes":string}
update: {"type":"update","id":string,"title"?,"startsAt"?,"endsAt"?,"allDay"?,"important"?,"notes"?,"kind"?}
complete / uncomplete / delete: {"type":"...","id":string}`;

  const history = input.history
    .filter(
      (t) =>
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim()
    )
    .slice(-12)
    .map((t) => ({
      role: t.role,
      content: t.content.slice(0, 4_000),
    }));
  while (history.length > 0 && history[0]!.role !== "user") {
    history.shift();
  }

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.1,
    system,
    messages: [
      ...history,
      { role: "user", content: input.message.trim().slice(0, 4_000) },
    ],
  });

  recordAiUsage({
    model: MODEL,
    inputTokens: msg.usage?.input_tokens,
    outputTokens: msg.usage?.output_tokens,
    feature: "calendar-chat",
    userId: input.userId ?? null,
  });

  const text =
    msg.content.find((b) => b.type === "text" && "text" in b)?.text ?? "";
  return parseCalendarChatResponse(text);
}
