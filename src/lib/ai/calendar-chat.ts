import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import {
  formatCalendarContext,
  parseCalendarChatResponse,
  type CalendarChatAction,
} from "@/lib/calendar/calendar-chat";
import type { CalendarItem } from "@/types/calendar";

const MODEL =
  process.env.ANTHROPIC_TUTOR_FAST_MODEL?.trim() || "claude-haiku-4-5";

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

  const now = new Date(input.nowIso);
  const nowLabel = Number.isNaN(now.getTime())
    ? new Date().toISOString()
    : now.toISOString();

  const system = `You are ${AI_ASSISTANT_NAME} on ${APP_NAME}, helping this student manage their personal calendar (todos, events, due dates).

NOW: ${nowLabel}
TIMEZONE: ${input.timeZone || "local"}

${formatCalendarContext(input.items, Number.isNaN(now.getTime()) ? new Date() : now)}

You can answer questions AND change the calendar. When they ask to add, move, complete, or remove something, emit actions. When they only ask (what's due, what's next, what's on Friday), reply only — no actions.

Rules:
- Ground answers in the CALENDAR ITEMS list. If it is empty, say so and offer to add something.
- Interpret relative dates ("tomorrow", "Friday 3pm", "next week") using NOW + TIMEZONE. Put startsAt/endsAt as ISO-8601 timestamps in that zone.
- Todos: kind "todo". Use startsAt as the due date (allDay true unless they gave a clock time).
- Timed events / classes / exams: kind "event". allDay false when they gave a time.
- Mark important/exams/deadlines with important true.
- Copy item ids from [id] when completing, updating, or deleting. If you only have a title, put that title in "id" and the server will resolve it.
- Never invent events that they did not ask to add.
- No emoji. Warm, short replies.

Output ONLY one JSON object:
{"reply": string, "actions": []}

actions items:
{"type":"create","title":string,"kind":"todo"|"event","startsAt":string|null,"endsAt":string|null,"allDay":boolean,"important":boolean,"notes":string}
{"type":"update","id":string,"title"?:string,"startsAt"?:string|null,"endsAt"?:string|null,"allDay"?:boolean,"important"?:boolean,"notes"?:string,"kind"?:"todo"|"event"}
{"type":"complete","id":string}
{"type":"uncomplete","id":string}
{"type":"delete","id":string}

"reply" is required (what the student reads). "actions" may be []. Never mention this JSON in the reply.`;

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
    max_tokens: 1200,
    temperature: 0.2,
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
