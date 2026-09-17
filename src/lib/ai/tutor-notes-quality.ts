/**
 * Shared writing standards for live auto-notes and end-of-session recaps.
 * Keep these aligned so auto-generate notes feel like the recap quality.
 */

export const TUTOR_NOTES_QUALITY_RULES = `QUALITY BAR (match a polished session recap — not a chat log):
- Sound like a thoughtful TA wrote study notes: polished, warm, specific.
- Synthesize ideas into clear academic prose — never paste spoken filler ("okay so", "right?", "here's the thing").
- Each bullet teaches something concrete: what it is, why it matters, how it works, or cause→effect.
- Use bold lead-ins for key terms, laws, and accounting line items.
- Include worked examples or journal entries when the tutor discussed calculations, entries, or formulas.
- One "remember this" callout for exam traps, common misconceptions, or high-stakes rules.
- NO generic study-skills fluff ("review your notes", "stay engaged") unless that was the actual topic.
- NO meta commentary about Rose or the session — only domain content.`;

/**
 * Shared default organization for generated notes. Tutor synthesis maps this
 * to AutoGenerateBlock JSON; live synthesis maps it to equivalent Markdown.
 */
export const DEFAULT_NOTES_OUTLINE_RULES = `DEFAULT NOTES OUTLINE:
- Start each genuinely new topic with a short, specific topic heading.
- Follow the heading with a 1–2 sentence framing paragraph when there is enough material to explain the topic, rather than turning every sentence into a bullet.
- Group the load-bearing points into 2–6 top-level bullets. Use **bold lead-ins** for terms or concepts, and nested children for definitions, steps, examples, contrasts, evidence, or supporting details. Avoid a long flat list of same-level bullets.
- Use a short worked-example/formula block when calculations, procedures, or equations were taught.
- Add vocabulary, a takeaway/callout, or self-check prompts only when they materially help; do not force boilerplate subsections into every topic.
- Keep one coherent topic section together. Continued detail enriches that section's existing organization instead of creating another heading.`;

/**
 * Shared redundancy contract for every chunked note generator (live slices,
 * slide batches, mentored lesson chunks, tutor turns). Chunk writers only see
 * a window of the document, so they are told explicitly how to treat material
 * the document already establishes. Subject-neutral by design.
 */
export const UNIFIED_NOTES_RULES = `ONE COHERENT DOCUMENT (redundancy control):
- You are producing one coherent set of notes from the complete course material — not a stack of independent summaries. Whatever you write must fit the document that already exists.
- Repeated source material (the instructor reviewing, restarting an explanation, answering a question by re-explaining, summarizing what was just said) is repeated EVIDENCE, not new note content.
- Before explaining a concept, check what the notes already establish (the CONCEPT COVERAGE / existing sections you were given). If it is already DEFINED or EXPLAINED there, do not re-define or re-explain it. Write only what is genuinely new — a new example, evidence, exception, qualification, mechanism step, application, contrast, or connection — and put it where that concept's explanation lives when it belongs there.
- Naming an established concept again is fine (repeated terminology is expected). When readability needs it, add ONE short reminder clause ("recall that X does Y") — never a second full explanation.
- A concept that is so far only MENTIONED gets its first real explanation the first time the source explains it substantively.
- Never drop or thin genuinely new details just because the concept appeared earlier. Optimize for completeness with no repeated explanations — not for shorter output.
- Before starting a new heading, ask whether the material introduces enough unique information to justify its own section. If most of it already exists elsewhere, fold the new details into that section instead.`;

/**
 * How to treat low-confidence source content (STT mishears, garbled slides).
 * Reuses the existing **Open question:** convention for load-bearing doubt.
 */
export const SOURCE_CONFIDENCE_RULES = `SOURCE CONFIDENCE (imperfect transcripts):
- Speech-to-text is unreliable for proper nouns, technical terms, acronyms, names, equations, and numbers. Never turn an unclear token into a confident fact.
- To settle an uncertain term, prefer in this order: instructor-provided written material; slides / on-screen text; clearly transcribed speech; the same term repeated consistently elsewhere in the transcript; surrounding context. Normalize or correct only when that evidence makes you confident.
- When you remain unsure: omit the questionable detail, or — if it is load-bearing — keep it visible as "- **Open question:** heard "<as transcribed>" — unclear term/number." Never fabricate a plausible-looking term.
- Represent what THIS course taught (its wording, order, and emphasis). Do not drift into a generic textbook chapter.`;

export const TUTOR_NOTES_JSON_SHAPE = `{
  "emoji"?: string,
  "heading": string,
  "intro"?: string,
  "bullets": Array<string | { "text": string, "bold"?: string, "children"?: string[] }>,
  "examples"?: Array<{ "label"?: string, "content": string }>,
  "vocabulary"?: Array<{ "term": string, "definition": string }>,
  "callout"?: { "emoji"?: string, "text": string },
  "selfCheck"?: string[]
}`;
