/**
 * Transforms Rose's spoken tutor reply into structured study notes.
 * Uses the same quality bar as end-of-session recaps (Sonnet, rich sections).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";
import type { TutorSessionMessage } from "@/types/tutor-session";
import {
  TUTOR_NOTES_JSON_SHAPE,
  TUTOR_NOTES_QUALITY_RULES,
} from "@/lib/ai/tutor-notes-quality";

const MODEL =
  process.env.ANTHROPIC_TUTOR_MODEL?.trim() || "claude-sonnet-4-6";

/** Rose lines that are session meta — never feed into notes synthesis. */
const SKIP_ASSISTANT_PATTERNS = [
  /^hey, still with me/i,
  /^i'll pause our session/i,
  /^\(couldn't upload/i,
  /^\(starting your session/i,
  /^sorry — i hit a snag/i,
];

export function isSystemTutorUtterance(content: string): boolean {
  return content.trim().startsWith("[");
}

/** True when a transcript line contains substantive teaching content. */
export function isTutorTurnEligibleForNotes(
  role: TutorSessionMessage["role"],
  content: string
): boolean {
  if (role !== "assistant") return false;
  const text = content.trim();
  if (text.length < 80) return false;
  if (isSystemTutorUtterance(text)) return false;
  return !SKIP_ASSISTANT_PATTERNS.some((re) => re.test(text));
}

export function formatTranscriptForNotesSynthesis(
  transcript: TutorSessionMessage[]
): string {
  const lines: string[] = [];
  for (const m of transcript) {
    const text = m.content.trim();
    if (!text) continue;
    if (m.role === "user" && isSystemTutorUtterance(text)) continue;
    if (m.role === "assistant" && !isTutorTurnEligibleForNotes(m.role, text)) {
      continue;
    }
    lines.push(`${m.role === "user" ? "STUDENT" : "ROSE"}: ${text}`);
  }
  return lines.join("\n\n").slice(0, 28_000);
}

function stripJsonFence(s: string): string {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Validate/clip a model-returned notes section into an `AutoGenerateBlock`. */
export function normalizeBlock(raw: unknown): AutoGenerateBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const emoji =
    typeof o.emoji === "string" ? o.emoji.trim().slice(0, 4) : undefined;
  let heading =
    typeof o.heading === "string" ? o.heading.trim().slice(0, 120) : "";
  if (emoji && heading && !heading.startsWith(emoji)) {
    heading = `${emoji} ${heading}`;
  }
  const intro =
    typeof o.intro === "string" ? o.intro.trim().slice(0, 600) : undefined;

  const bullets: AutoGenerateBlock["bullets"] = [];
  if (Array.isArray(o.bullets)) {
    for (const item of o.bullets) {
      if (typeof item === "string" && item.trim()) {
        bullets.push(item.trim().slice(0, 400));
      } else if (item && typeof item === "object") {
        const b = item as Record<string, unknown>;
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (!text) continue;
        const bold = typeof b.bold === "string" ? b.bold.trim() : undefined;
        const children = Array.isArray(b.children)
          ? b.children
              .filter(
                (c): c is string =>
                  typeof c === "string" && c.trim().length > 0
              )
              .map((c) => c.trim().slice(0, 280))
          : undefined;
        bullets.push(
          bold || children?.length
            ? { text: text.slice(0, 400), bold, children }
            : text.slice(0, 400)
        );
      }
    }
  }

  const examples: AutoGenerateBlock["examples"] = [];
  if (Array.isArray(o.examples)) {
    for (const ex of o.examples) {
      if (!ex || typeof ex !== "object") continue;
      const row = ex as Record<string, unknown>;
      const content =
        typeof row.content === "string" ? row.content.trim() : "";
      if (!content) continue;
      examples.push({
        label:
          typeof row.label === "string"
            ? row.label.trim().slice(0, 80)
            : undefined,
        content: content.slice(0, 1200),
      });
    }
  }

  const vocabulary: AutoGenerateBlock["vocabulary"] = [];
  if (Array.isArray(o.vocabulary)) {
    for (const v of o.vocabulary) {
      if (!v || typeof v !== "object") continue;
      const row = v as Record<string, unknown>;
      const term = typeof row.term === "string" ? row.term.trim() : "";
      if (!term) continue;
      vocabulary.push({
        term: term.slice(0, 80),
        definition:
          typeof row.definition === "string"
            ? row.definition.trim().slice(0, 300)
            : undefined,
      });
    }
  }

  let callout: AutoGenerateBlock["callout"];
  if (o.callout && typeof o.callout === "object") {
    const c = o.callout as Record<string, unknown>;
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (text) {
      callout = {
        emoji: typeof c.emoji === "string" ? c.emoji.slice(0, 4) : "💡",
        text: text.slice(0, 400),
      };
    }
  }

  const selfCheck: string[] = [];
  if (Array.isArray(o.selfCheck)) {
    for (const q of o.selfCheck) {
      if (typeof q === "string" && q.trim()) {
        selfCheck.push(q.trim().slice(0, 240));
      }
    }
  }

  if (
    !heading &&
    bullets.length === 0 &&
    vocabulary.length === 0 &&
    !callout &&
    examples.length === 0
  ) {
    return null;
  }

  return {
    heading: heading || "Key concepts",
    intro,
    bullets: bullets.slice(0, 10),
    examples: examples.length > 0 ? examples.slice(0, 3) : undefined,
    vocabulary: vocabulary.length > 0 ? vocabulary.slice(0, 8) : undefined,
    callout,
    selfCheck: selfCheck.length > 0 ? selfCheck.slice(0, 4) : undefined,
  };
}

const SYNTHESIS_SYSTEM = `You convert a tutor's SPOKEN explanation into ONE polished study-notes section for the student's notebook.

${TUTOR_NOTES_QUALITY_RULES}

SECTION STRUCTURE:
- heading: short topic title (3–8 words), not Rose's first sentence.
- emoji: ONE topic emoji (optional, separate from heading).
- intro: 1–2 sentences framing what this section covers.
- bullets: 4–8 substantive bullets with bold key terms; use nested children for steps, contrasts, or sub-points.
- examples: when math, journal entries, formulas, or calculations were taught, add 1–2 monospace-friendly blocks (Debit/Credit lines, equations, roll-forwards).
- vocabulary: 2–5 important terms with tight definitions.
- callout: one "remember this" takeaway for traps or misconceptions.
- selfCheck: 1–2 short review questions ONLY when the explanation was substantial (skip for brief clarifications).

Output ONLY valid JSON (no markdown fences):
${TUTOR_NOTES_JSON_SHAPE}`;

const BACKFILL_SYSTEM = `You convert a FULL tutor session transcript into structured study notes for the student's notebook.

The session may span multiple exchanges. Synthesize EVERY substantive concept Rose taught — not just the final turn.

${TUTOR_NOTES_QUALITY_RULES}

ORGANIZE into 3–8 SECTIONS grouped by topic/theme (e.g. "Contra-Asset Accounts & Depreciation", "Revenue Recognition"). Each section uses the JSON shape below.

After the topic sections, add TWO final sections:
1. heading "Key terms" — vocabulary bullets summarizing the most important terms across the session (8–12 items).
2. heading "Self-check & next steps" — intro optional; bullets mixing 3–5 self-check questions AND 2–4 specific "what to study next" actions tied to gaps in the conversation.

SKIP: greetings, inactivity check-ins, session logistics, quiz-only turns with no teaching.

Output ONLY valid JSON (no markdown fences):
{
  "sections": Array<${TUTOR_NOTES_JSON_SHAPE}>
}`;

export async function synthesizeTutorNotes(input: {
  roseReply: string;
  studentUtterance?: string;
  sessionTopic?: string;
  modeTag?: string | null;
}): Promise<AutoGenerateBlock | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const rose = input.roseReply.trim().slice(0, 8000);
  if (rose.length < 40) return null;

  const student =
    typeof input.studentUtterance === "string"
      ? input.studentUtterance.trim().slice(0, 800)
      : "";
  const topic = input.sessionTopic?.trim().slice(0, 300) ?? "";
  const mode = input.modeTag?.replace(/_/g, " ") ?? "";

  const userPrompt = [
    topic ? `SESSION TOPIC: ${topic}` : null,
    mode ? `MODE: ${mode}` : null,
    student ? `STUDENT SAID:\n${student}` : null,
    `ROSE EXPLAINED (spoken — synthesize, do NOT copy verbatim):\n${rose}`,
    "\nWrite one polished study-notes section as JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 });

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      temperature: 0.35,
      system: SYNTHESIS_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(block.text));
    } catch {
      console.error("[synthesizeTutorNotes] invalid JSON", block.text.slice(0, 200));
      return null;
    }

    const normalized = normalizeBlock(parsed);
    console.log("[synthesizeTutorNotes] ok", {
      model: MODEL,
      heading: normalized?.heading,
      bulletCount: normalized?.bullets.length ?? 0,
      exampleCount: normalized?.examples?.length ?? 0,
    });
    return normalized;
  } catch (e) {
    console.error("[synthesizeTutorNotes]", e);
    return null;
  }
}

export async function synthesizeTutorNotesFromTranscript(input: {
  transcript: TutorSessionMessage[];
  sessionTopic?: string;
  modeTag?: string | null;
  referenceSummary?: string;
}): Promise<AutoGenerateBlock[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const transcriptText = formatTranscriptForNotesSynthesis(input.transcript);
  if (transcriptText.length < 120) return [];

  const topic = input.sessionTopic?.trim().slice(0, 300) ?? "";
  const mode = input.modeTag?.replace(/_/g, " ") ?? "";
  const reference = input.referenceSummary?.trim().slice(0, 2000) ?? "";

  const userPrompt = [
    topic ? `SESSION TOPIC: ${topic}` : null,
    mode ? `MODE: ${mode}` : null,
    reference ? `REFERENCE MATERIALS SUMMARY:\n${reference}` : null,
    `FULL TRANSCRIPT (synthesize all substantive teaching):\n${transcriptText}`,
    "\nWrite recap-quality study notes JSON with all sections now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6000,
      temperature: 0.35,
      system: BACKFILL_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(block.text));
    } catch {
      console.error(
        "[synthesizeTutorNotesFromTranscript] invalid JSON",
        block.text.slice(0, 200)
      );
      return [];
    }

    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];

    const blocks: AutoGenerateBlock[] = [];
    for (const section of sections) {
      const normalized = normalizeBlock(section);
      if (normalized) blocks.push(normalized);
    }

    console.log("[synthesizeTutorNotesFromTranscript] ok", {
      model: MODEL,
      sectionCount: blocks.length,
    });
    return blocks.slice(0, 12);
  } catch (e) {
    console.error("[synthesizeTutorNotesFromTranscript]", e);
    return [];
  }
}
