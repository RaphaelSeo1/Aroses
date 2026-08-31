import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { tutorChatModel } from "@/lib/ai/anthropic-models";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import { AI_ASSISTANT_NAME, APP_NAME } from "@/lib/brand";
import {
  dateCheatSheet,
  formatCalendarContext,
  parseCalendarModelContent,
  type CalendarChatAction,
} from "@/lib/calendar/calendar-chat";
import { MAX_CHAT_PDF_CHARS } from "@/lib/live-notes/extract-chat-pdf";
import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";

const MODEL = tutorChatModel();

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_item",
    description:
      "Add a todo or event now. Call this in the same turn the student asks to add, schedule, or remind. Copy date from DATE KEYS.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["todo", "event"] },
        date: {
          type: "string",
          description: "YYYY-MM-DD copied exactly from DATE KEYS",
        },
        time: {
          type: "string",
          description:
            "Local clock if they gave one, 24h HH:MM or h:mm am/pm. Omit for all-day / due-date.",
        },
        important: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["title", "kind"],
    },
  },
  {
    name: "complete_item",
    description: "Mark a todo done. item is the [id] or the exact title.",
    input_schema: {
      type: "object",
      properties: { item: { type: "string" } },
      required: ["item"],
    },
  },
  {
    name: "uncomplete_item",
    description: "Undo a completed item.",
    input_schema: {
      type: "object",
      properties: { item: { type: "string" } },
      required: ["item"],
    },
  },
  {
    name: "delete_item",
    description:
      "Remove an item. For 'clear finished tasks', call once per done item (up to 8).",
    input_schema: {
      type: "object",
      properties: { item: { type: "string" } },
      required: ["item"],
    },
  },
  {
    name: "update_item",
    description: "Rename or reschedule an existing item.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "[id] or exact title" },
        title: { type: "string" },
        kind: { type: "string", enum: ["todo", "event"] },
        date: { type: "string", description: "YYYY-MM-DD from DATE KEYS" },
        time: { type: "string" },
        important: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["item"],
    },
  },
];

export type CalendarChatTurn = { role: "user" | "assistant"; content: string };

export async function runCalendarChat(input: {
  message: string;
  history: CalendarChatTurn[];
  items: CalendarItem[];
  sections?: CalendarTodoSection[];
  nowIso: string;
  timeZone: string;
  userId?: string;
  attachedPdfText?: string;
  attachedPdfName?: string;
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
  const attachedPdfText = (input.attachedPdfText ?? "").trim();
  const attachedPdfName = (input.attachedPdfName ?? "").trim().slice(0, 200);
  const pdfBlock = attachedPdfText
    ? `ATTACHED FILE${attachedPdfName ? ` (${attachedPdfName})` : ""}:\n${attachedPdfText.slice(0, MAX_CHAT_PDF_CHARS)}`
    : "";

  const system = `You are ${AI_ASSISTANT_NAME} on ${APP_NAME}. You manage this student's calendar. Execute the request in this turn. Talking about what you would do without calling a tool is a failure.

${dateCheatSheet(input.nowIso, tz)}
TIMEZONE: ${tz}

${formatCalendarContext(input.items, nowSafe, tz, input.sections ?? [])}
${pdfBlock ? `\n${pdfBlock}\n` : ""}
TOOLS:
- Questions only (what's due, what's next, what's on Friday) → answer from CALENDAR ITEMS. No tools.
- Add / schedule / remind → create_item. Copy date from DATE KEYS. Include time only if they gave a clock time.
- Complete / check off → complete_item.
- Delete / remove / cancel / clear finished → delete_item (one call per item, up to 8).
- Move / rename → update_item.
- Never invent items that are not in CALENDAR ITEMS when answering what's due.
- Todos: kind "todo". Timed class/quiz/meeting: kind "event". Exams and hard deadlines: important true.
- Prefer the [id] in item. Title is ok if you cannot copy the id.
- Attached file is reference only (syllabus, schedule, assignment sheet, screenshot). When they ask to add dates from it — or send it with no extra question — create_item for dated exams, assignments, and classes (up to 8). Copy those dates from DATE KEYS. Extra detail goes in notes. Do not invent dates that are not in the file or their message.
- Reply in 1–2 short sentences: what you did, or the matching due items (title + date + time). No emoji. Do not mention tools, ids, or JSON.`;

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
    temperature: 0,
    system,
    tools: TOOLS,
    tool_choice: { type: "auto" },
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

  const parsed = parseCalendarModelContent(
    msg.content.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") {
        return { type: "tool_use", name: b.name, input: b.input };
      }
      return { type: b.type };
    })
  );

  return {
    reply:
      parsed.reply ||
      (parsed.actions.length > 0 ? "Updated your calendar." : ""),
    actions: parsed.actions,
  };
}
