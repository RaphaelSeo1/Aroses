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
