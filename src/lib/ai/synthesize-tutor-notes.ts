/**
 * Transforms Rose's spoken tutor reply into structured study notes.
 * Used instead of sentence-splitting the transcript — notes should
 * read like a TA wrote them, not like a chat log.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AutoGenerateBlock } from "@/components/immersive/NotesPanel";
import type { TutorSessionMessage } from "@/types/tutor-session";

const FAST_MODEL =
  process.env.ANTHROPIC_TUTOR_FAST_MODEL || "claude-haiku-4-5";

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

function normalizeBlock(raw: unknown): AutoGenerateBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const heading =
    typeof o.heading === "string" ? o.heading.trim().slice(0, 120) : "";
  const intro =
    typeof o.intro === "string" ? o.intro.trim().slice(0, 500) : undefined;

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
        text: text.slice(0, 320),
      };
    }
  }

  if (!heading && bullets.length === 0 && vocabulary.length === 0 && !callout) {
    return null;
  }

  return {
    heading: heading || "Key concepts",
    intro,
    bullets: bullets.slice(0, 8),
    vocabulary: vocabulary.length > 0 ? vocabulary.slice(0, 8) : undefined,
    callout,
  };
}

const SYNTHESIS_SYSTEM = `You convert a tutor's SPOKEN explanation into polished written study notes for a student's notebook.

The input is conversational (filler, rhetorical questions, "right?", "so here's the thing"). Your output must NOT read like a transcript.

RULES:
1. SYNTHESIZE — extract ideas, mechanisms, definitions, and cause→effect links. Rewrite in clear academic prose.
2. NO transcript voice — never use "Alright", "So here's the thing", "right?", "This is where…", or other spoken filler.
3. NO rhetorical questions as bullets — turn them into statements of fact.
4. DEPTH — each bullet should teach something concrete (what it is, why it matters, how it works). Prefer 4–7 substantive bullets over shallow sentence splits.
5. BOLD KEY TERMS — use "bold" on the leading term/concept in each bullet when applicable.
6. NESTED DETAIL — use "children" sub-bullets for examples, steps, or exceptions when helpful (max 2–3 per parent).
7. VOCABULARY — list 1–4 important terms with tight definitions the student can review later.
8. CALLOUT — one "remember this" takeaway if there's a high-stakes insight (exam trap, common misconception, legal implication).
9. HEADING — short topic title (3–8 words), not the first spoken sentence.
10. INTRO — optional one-sentence thesis of what this section covers (not a copy of Rose's opener).
11. NO meta study-skills advice — only domain content from what Rose actually taught.

Output ONLY valid JSON (no markdown fences):
{
  "heading": string,
  "intro"?: string,
  "bullets": Array<string | { "text": string, "bold"?: string, "children"?: string[] }>,
  "vocabulary"?: Array<{ "term": string, "definition": string }>,
  "callout"?: { "emoji"?: string, "text": string }
}`;

const BACKFILL_SYSTEM = `You convert a FULL tutor session transcript into structured study notes for the student's notebook.

The session may span multiple days. Synthesize EVERY substantive concept Rose taught across the entire conversation — not just the final exchange.

RULES:
1. DOMAIN CONTENT ONLY — extract actual subject matter (definitions, laws, mechanisms, examples). NEVER write generic study-skills meta advice ("review your notes", "pace yourself", "active engagement", "readiness check") unless that was literally the topic taught.
2. SYNTHESIZE — rewrite in clear academic prose. No spoken filler.
3. ORGANIZE into 2–6 SECTIONS grouped by topic/theme (e.g. "Annual Report Credibility", "GAAP & Auditing"). Not one section per chat message.
4. DEPTH — each section has 4–7 substantive bullets with bold key terms and optional nested children.
5. VOCABULARY — 1–4 terms per section when applicable.
6. CALLOUT — one high-stakes takeaway per section when relevant.
7. SKIP — greetings, inactivity check-ins ("still with me"), session logistics, quiz-only turns with no teaching.

Output ONLY valid JSON (no markdown fences):
{
  "sections": Array<{
    "heading": string,
    "intro"?: string,
    "bullets": Array<string | { "text": string, "bold"?: string, "children"?: string[] }>,
    "vocabulary"?: Array<{ "term": string, "definition": string }>,
    "callout"?: { "emoji"?: string, "text": string }
  }>
}`;

export async function synthesizeTutorNotes(input: {
  roseReply: string;
  studentUtterance?: string;
  sessionTopic?: string;
  modeTag?: string | null;
}): Promise<AutoGenerateBlock | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const rose = input.roseReply.trim().slice(0, 6000);
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
    `ROSE EXPLAINED (spoken — do NOT copy verbatim):\n${rose}`,
    "\nWrite study notes JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 0 });

  try {
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 1200,
      temperature: 0.25,
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
      heading: normalized?.heading,
      bulletCount: normalized?.bullets.length ?? 0,
      vocabCount: normalized?.vocabulary?.length ?? 0,
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
    "\nWrite study notes JSON with all sections now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });

  try {
    const msg = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 4000,
      temperature: 0.25,
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
      sectionCount: blocks.length,
    });
    return blocks.slice(0, 8);
  } catch (e) {
    console.error("[synthesizeTutorNotesFromTranscript]", e);
    return [];
  }
}
