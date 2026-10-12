/**
 * Turns a lesson chunk into a picture prompt, and decides how much of that
 * picture is visible while the explanation is still being taught.
 * The image call itself lives next to the API route so this file stays pure.
 */

export type BoardVisualForm = "still" | "animation" | "clip";

export function parseVisualForm(raw: unknown): BoardVisualForm {
  return raw === "animation" || raw === "clip" ? raw : "still";
}

export function motionLine(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 300);
  return text.length >= 8 ? text : undefined;
}

export function illustrationForChunk(
  chunk: {
    concept: string;
    explanation: string;
    analogy?: string;
    keyPoints: string[];
    keyTerms?: string[];
    illustrationBrief?: string;
    analogyIllustration?: string;
    visualForm?: BoardVisualForm;
    motion?: string;
    analogyVisualForm?: BoardVisualForm;
    analogyMotion?: string;
  },
  attempts: number
): {
  title: string;
  brief: string;
  labels: string[];
  script: string;
  kicker: string;
  form: BoardVisualForm;
  motion?: string;
} | null {
  const missed = attempts > 0 && Boolean(chunk.analogy || chunk.analogyIllustration);
  const brief = missed
    ? (pictureBrief(chunk.analogyIllustration) ?? pictureBrief(chunk.analogy))
    : (pictureBrief(chunk.illustrationBrief) ?? pictureBrief(chunk.explanation));
  if (!brief) return null;
  const form = missed
    ? parseVisualForm(chunk.analogyVisualForm)
    : parseVisualForm(chunk.visualForm);
  const motion = missed
    ? motionLine(chunk.analogyMotion)
    : motionLine(chunk.motion);
  return {
    title: chunk.concept,
    brief,
    labels: boardPartLabels(chunk.concept, chunk.keyTerms, chunk.keyPoints),
    script: missed ? chunk.analogy || chunk.explanation : chunk.explanation,
    kicker: missed ? "New analogy" : "Whiteboard",
    form: form === "still" || motion ? form : "still",
    motion,
  };
}

/** The student asked to see the idea, not to hear it again. */
export function asksForVisualization(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (text.length < 3) return false;
  const lower = text.toLowerCase();
  if (/\b(visuali[sz]e|visuali[sz]ation|diagram|animation|whiteboard)\b/.test(lower)) {
    return true;
  }
  if (/\b(draw|sketch|illustrate)\b/.test(lower) && /\b(it|this|that|concept|me|board)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(show|see|watch|play)\b/.test(lower) &&
    /\b(picture|drawing|video|animation|diagram|visual)\b/.test(lower)
  ) {
    return true;
  }
  return /시각화|그림으로|그려\s*줘|그림\s*보여/.test(text);
}

/**
 * Picture payload for "show me a visualization", using the concept being discussed.
 * Falls back to the explanation when the lesson plan has no picture brief.
 */
export function illustrationForRequest(chunk: {
  concept: string;
  explanation: string;
  analogy?: string;
  keyPoints: string[];
  keyTerms?: string[];
  illustrationBrief?: string;
  analogyIllustration?: string;
  visualForm?: BoardVisualForm;
  motion?: string;
  analogyVisualForm?: BoardVisualForm;
  analogyMotion?: string;
}): {
  title: string;
  brief: string;
  labels: string[];
  script: string;
  kicker: string;
  form: BoardVisualForm;
  motion?: string;
} | null {
  const ready = illustrationForChunk(chunk, 0);
  if (ready) return ready;
  const brief = [chunk.explanation, ...chunk.keyPoints]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const usable = pictureBrief(brief) ?? pictureBrief(`${chunk.concept}. ${brief}`);
  if (!usable) return null;
  return {
    title: chunk.concept,
    brief: usable,
    labels: boardPartLabels(chunk.concept, chunk.keyTerms, chunk.keyPoints),
    script: chunk.explanation || chunk.concept,
    kicker: "Whiteboard",
    form: "animation",
    motion: motionLine(chunk.motion),
  };
}

function boardPartLabels(concept: string, terms: string[] | undefined, points: string[]): string[] {
  const title = concept.replace(/\s+/g, " ").trim().toLowerCase();
  return shortLabels(terms, points)
    .filter((label) => label.split(/\s+/).length <= 3 && label.length <= 24)
    .filter((label) => label.toLowerCase() !== title)
    .slice(0, 4);
}

function shortLabels(terms: string[] | undefined, points: string[]): string[] {
  const clean = (values: string[], max: number) =>
    values
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 1 && value.length <= max)
      .slice(0, 8);
  const fromTerms = clean(terms ?? [], 32);
  if (fromTerms.length > 0) return fromTerms;
  return clean(points, 24);
}

/** The caption beside the drawing. Real text, taken from what Rose is saying. */
export function captionLine(spoken: string, script: string): string {
  const source = spoken.trim() || script.trim();
  if (!source) return "";
  const parts = source.split(/(?<=[.!?])\s+/).filter((part) => part.length > 0);
  const line = parts[parts.length - 1] ?? source;
  return line.slice(0, 180);
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

/** Which frame of a motion is on screen. 0 is the start; the last index is the end. */
export function motionFrameIndex(progress: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  const t = Math.min(1, Math.max(0, progress));
  return Math.min(frameCount - 1, Math.floor(t * frameCount * 0.999));
}

/**
 * The opening picture, then the edit instruction for the middle and the end.
 * Later frames must show the moving part in a new place, not a copy of the start.
 */
export function motionStageBriefs(brief: string, motion: string): string[] {
  const scene = brief.trim().slice(0, 500);
  const move = motion.trim().slice(0, 300);
  return [
    `${scene} Draw this before anything moves. One of each object, in its starting position only. Do not also draw where it will end up.`,
    move,
    move,
  ];
}

export function motionEditPrompt(stage: "middle" | "end", motion: string): string {
  const where =
    stage === "middle"
      ? "Move that part about halfway from where it starts to where it finishes."
      : "Move that part all the way to its final place. This frame must look different from the start.";
  return [
    "Edit this teaching diagram. Keep the same background, axes, colors, and labels.",
    "One of each moving object only. Erase any ghost of its earlier position.",
    where,
    `The change: ${motion.trim().slice(0, 300)}`,
  ].join(" ");
}

export function clipPrompt(input: {
  title: string;
  brief: string;
  labels: string[];
  motion: string;
}): string {
  const labels = input.labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length >= 1 && label.length <= 42)
    .slice(0, 6);
  const words =
    labels.length > 0
      ? `The only words allowed are: ${labels.map((label) => `"${label}"`).join(", ")}.`
      : "Do not put any words in the clip.";
  return [
    "A four-second teaching clip on a dark charcoal board. Flat, precise, slightly painterly shapes in rose, gold, and blue.",
    "One continuous shot. The same objects stay in the frame the whole time. No cuts, no slideshow, no photograph, no watermark, no app chrome.",
    `The idea (do not print it as a title): ${input.title.trim().slice(0, 120)}.`,
    `The scene: ${input.brief.trim().slice(0, 500)}`,
    `What moves, smoothly and clearly, from the first moment to the last: ${input.motion.trim().slice(0, 300)}`,
    words,
  ].join("\n");
}
