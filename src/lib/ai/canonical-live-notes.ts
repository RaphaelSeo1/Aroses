import "server-only";
import { liveNotesFinalModel } from "@/lib/ai/live-notes-models";
import { recordAiUsage } from "@/lib/billing/ai-usage";
import {
  buildCanonicalNotesUserPrompt,
  CANONICAL_NOTES_SYSTEM,
  hasCanonicalNoteSources,
  type CanonicalDraftSection,
  type CanonicalNoteSourceBundle,
} from "@/lib/live-notes/canonical-synthesis";
import { stripProtocolLines } from "@/lib/live-notes/marker-protocol";

const REQUEST_TIMEOUT_MS = 110_000;

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export async function synthesizeCanonicalLiveNotes(input: {
  title?: string;
  sources: CanonicalNoteSourceBundle;
  existingSections?: CanonicalDraftSection[];
  noteInstruction?: string;
  userId?: string;
}): Promise<string | null> {
  if (!hasCanonicalNoteSources(input.sources)) return null;
  if (input.sources.complete === false) {
    throw new Error(
      `Canonical note sources are incomplete: ${
        input.sources.incompleteReasons?.join(", ") || "unknown source gap"
      }`
    );
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Notes need OPENAI_API_KEY.");

  const model = liveNotesFinalModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_completion_tokens: 20_000,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: CANONICAL_NOTES_SYSTEM },
          {
            role: "user",
            content: buildCanonicalNotesUserPrompt(input),
          },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(
        `Canonical notes model failed (${res.status}). ${raw.slice(0, 300)}`
      );
    }
    const parsed = JSON.parse(raw) as OpenAiChatResponse;
    recordAiUsage({
      model,
      inputTokens: parsed.usage?.prompt_tokens,
      outputTokens: parsed.usage?.completion_tokens,
      feature: "live-notes-canonical-synthesis",
      userId: input.userId ?? null,
    });
    const content = parsed.choices?.[0]?.message?.content;
    const markdown = content
      ? stripProtocolLines(content)
          .replace(/^```(?:markdown|md)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim()
      : "";
    return markdown || null;
  } finally {
    clearTimeout(timer);
  }
}
