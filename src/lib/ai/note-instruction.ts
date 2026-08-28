/** Max length of a per-session free-text note instruction. */
export const NOTE_INSTRUCTION_MAX = 300;

/**
 * Wrap a student's free-text note instruction as a style modifier to
 * append UNDER a surface's base style block. Returns "" for empty/whitespace
 * (a strict no-op — the generator uses its base prompt unchanged).
 *
 * Density, structure, language, and voice follow the student. Grounding
 * (no invented facts / outside knowledge) still always wins.
 */
export function buildNoteInstructionModifier(
  raw: string | null | undefined
): string {
  const text = (raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTE_INSTRUCTION_MAX);
  if (!text) return "";
  return [
    "",
    "STUDENT NOTE STYLE FOR THIS SESSION — follow it NOW for how notes are written:",
    `"${text}"`,
    "This request GOVERNS density, structure, language, and voice of new and rewritten notes (bullets vs prose, short vs detailed, what to bold, headings, worked examples). If they asked for shorter notes, condense. If they asked for more detail, write more. That wins over the default thoroughness for STYLE only.",
    "It can NEVER authorize invented facts, outside knowledge, a different marker protocol, or skipping a number/name the lecturer actually taught.",
  ].join("\n");
}

/** Server-side clamp for a raw instruction value before persisting/using. */
export function clampNoteInstruction(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, NOTE_INSTRUCTION_MAX);
}
