/**
 * Turns a lesson chunk into a picture prompt, and decides how much of that
 * picture is visible while the explanation is still being taught.
 * The image call itself lives next to the API route so this file stays pure.
 */

export function illustrationForChunk(
  chunk: {
    concept: string;
    explanation: string;
    analogy?: string;
    keyPoints: string[];
    illustrationBrief?: string;
    analogyIllustration?: string;
  },
  attempts: number
): {
  title: string;
  brief: string;
  labels: string[];
  script: string;
  kicker: string;
} | null {
  const missed = attempts > 0 && Boolean(chunk.analogy || chunk.analogyIllustration);
  const brief = missed
    ? (pictureBrief(chunk.analogyIllustration) ?? pictureBrief(chunk.analogy))
    : (pictureBrief(chunk.illustrationBrief) ?? pictureBrief(chunk.explanation));
  if (!brief) return null;
  return {
    title: chunk.concept,
    brief,
    labels: chunk.keyPoints,
    script: missed ? chunk.analogy || chunk.explanation : chunk.explanation,
    kicker: missed ? "New analogy" : "Whiteboard",
  };
}

export function pictureBrief(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 700);
  return text.length >= 20 ? text : undefined;
}

/** How much of the drawing is on the board. 0.08 is the first stroke; 1 is finished. */
export function revealFraction(
  spoken: string,
  script: string,
  elapsedMs: number
): number {
  const full = script.trim();
  const said = spoken.trim();
  const fromSpeech =
    full.length > 0 && said.length > 0
      ? Math.min(1, said.length / full.length)
      : 0;
  const fromTime = Math.min(1, Math.max(0, elapsedMs) / 14_000);
  return Math.min(1, Math.max(0.08, fromSpeech, fromTime));
}

const STYLE = [
  "A premium illustrated teaching diagram on a dark charcoal board, the kind a lecturer draws while explaining one idea.",
  "Flat, precise, slightly painterly shapes. A few accent colors only: rose red, gold, and blue, on a near-black background.",
  "Draw the actual objects named below so a student can see how they fit together. Leave generous empty space.",
  "This is one picture, not a slideshow, not a photograph, not a cartoon character, not a page of notes, and not a flowchart made of text boxes and arrows.",
  "Keep every label fully inside the frame with empty space around it. Never cut off a letter.",
  "Spell each allowed label exactly, and use each label at most once. If a word might be misspelled or clipped, leave that label off.",
  "Draw every object the description names. Do not drop one, and do not add an object it does not mention.",
].join(" ");

export function illustrationPrompt(input: {
  title: string;
  brief: string;
  labels: string[];
}): string {
  const labels = input.labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length >= 1 && label.length <= 42)
    .slice(0, 6);
  const words =
    labels.length > 0
      ? `The only words allowed anywhere in the picture are these short labels, spelled exactly: ${labels
          .map((label) => `"${label}"`)
          .join(", ")}.`
      : "Do not put any words in the picture.";
  return [
    STYLE,
    `The idea being taught (do not print this as a heading): ${input.title.trim().slice(0, 120)}.`,
    `Draw only what this sentence describes. Do not add parts, numbers, labels, or events it does not mention: ${input.brief
      .trim()
      .slice(0, 700)}`,
    words,
    "No watermark, no border, no app chrome, no speech bubbles, no paragraphs.",
  ].join("\n");
}
