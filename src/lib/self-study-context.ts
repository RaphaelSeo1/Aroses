import type { MentoredPersonalization } from "@/types/mentored";

export type SelfStudyContextParts = {
  title?: string;
  summary?: string;
  bullets?: string[];
  rawGoal?: string;
};

const MAX_STORED_CHARS = 4000;

/** Rich blob stored on `courses.study_context` (and per-upload jobs). */
export function buildSelfStudyContextBlob(
  parts: SelfStudyContextParts
): string {
  const lines: string[] = [];
  if (parts.title?.trim()) {
    lines.push(`TITLE: ${parts.title.trim()}`);
  }
  if (parts.summary?.trim()) {
    lines.push(`SUMMARY: ${parts.summary.trim()}`);
  }
  if (parts.bullets && parts.bullets.length > 0) {
    lines.push("FOCUS AREAS:");
    for (const b of parts.bullets) {
      const t = b.trim();
      if (t) lines.push(`- ${t}`);
    }
  }
  if (parts.rawGoal?.trim()) {
    lines.push("FULL GOAL (student's words):");
    lines.push(parts.rawGoal.trim());
  }
  const blob = lines.join("\n").trim();
  if (!blob) return "";
  return blob.slice(0, MAX_STORED_CHARS);
}

/** Parse structured blobs; plain text falls back to summary-only. */
export function parseSelfStudyContextBlob(stored: string): SelfStudyContextParts {
  const text = stored.trim();
  if (!text) return {};

  const hasStructure =
    text.includes("FOCUS AREAS:") ||
    text.includes("FULL GOAL") ||
    text.startsWith("TITLE:") ||
    text.startsWith("SUMMARY:");

  if (!hasStructure) {
    return { summary: text };
  }

  const parts: SelfStudyContextParts = {};
  const lines = text.split("\n");
  const bullets: string[] = [];
  let section: "none" | "focus" | "goal" = "none";
  const goalLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("TITLE:")) {
      parts.title = line.slice("TITLE:".length).trim();
      section = "none";
      continue;
    }
    if (line.startsWith("SUMMARY:")) {
      parts.summary = line.slice("SUMMARY:".length).trim();
      section = "none";
      continue;
    }
    if (line === "FOCUS AREAS:") {
      section = "focus";
      continue;
    }
    if (line.startsWith("FULL GOAL")) {
      section = "goal";
      continue;
    }
    if (section === "focus" && line.startsWith("- ")) {
      bullets.push(line.slice(2).trim());
      continue;
    }
    if (section === "goal" && line.trim()) {
      goalLines.push(line);
    }
  }

  if (bullets.length > 0) parts.bullets = bullets;
  if (goalLines.length > 0) parts.rawGoal = goalLines.join("\n").trim();
  if (!parts.summary && parts.rawGoal) {
    parts.summary = parts.rawGoal.split(/\s+/).slice(0, 24).join(" ");
  }
  return parts;
}

/** Prompt block for course outline / module generation. */
export function formatSelfStudyGenerationBlock(stored: string): string {
  const parts = parseSelfStudyContextBlob(stored);
  if (!parts.summary && !parts.rawGoal && !parts.bullets?.length) {
    return "";
  }

  const focus =
    parts.bullets && parts.bullets.length > 0
      ? parts.bullets.map((b) => `  • ${b}`).join("\n")
      : "  (infer from goal text)";

  const goalBody =
    parts.rawGoal?.trim() ||
    parts.summary?.trim() ||
    "";

  return `
=== LEARNER CONTEXT (self-study — calibrate the ENTIRE course to this) ===
${parts.summary ? `Goal summary: ${parts.summary}` : ""}
${parts.title ? `Session title: ${parts.title}` : ""}

Focus areas (weight modules, lessons, and quizzes toward these):
${focus}

${goalBody ? `Full context:\n"""${goalBody.slice(0, 2_200)}"""` : ""}

Calibration rules (apply on outline, every lesson, and every quiz):
1. Emphasize FOCUS AREAS — more lessons, examples, and quiz items on those topics.
2. If they mention a deadline (exam, midterm, interview), pace for that timeline — cram-friendly vs deep-dive.
3. If they say they already know something, compress or skip it; expand weak spots they named.
4. Match vocabulary to their level (intro vs review vs advanced).
5. Quiz bank should disproportionately test focus areas and stated weak points.
=== END LEARNER CONTEXT ===`;
}

/** Shorter block for live tutoring (Rose / voice / chat). */
export function formatSelfStudyTutorBlock(stored: string): string {
  const parts = parseSelfStudyContextBlob(stored);
  if (!parts.summary && !parts.rawGoal && !parts.bullets?.length) {
    return stored.trim().slice(0, 1200);
  }

  const lines: string[] = [
    "SELF-STUDY PROFILE (they told us this at setup — calibrate depth, pacing, and examples every turn):",
  ];
  if (parts.summary) lines.push(`- Goal: ${parts.summary}`);
  if (parts.bullets?.length) {
    lines.push(`- Focus extra on: ${parts.bullets.join("; ")}`);
  }
  if (parts.rawGoal) {
    lines.push(`- Their words: """${parts.rawGoal.slice(0, 900)}"""`);
  }
  lines.push(
    "- If they sound rushed, prioritize focus areas. If they say they know a topic, fast-forward with a quick check."
  );
  return lines.join("\n");
}

/** Map stored context into Rose's personalization shape when onboarding is empty. */
export function selfStudyContextToPersonalization(
  stored: string
): MentoredPersonalization {
  const parts = parseSelfStudyContextBlob(stored);
  const focusAreas = parts.bullets?.filter(Boolean).slice(0, 8) ?? [];
  const summary =
    parts.summary?.trim() ||
    parts.rawGoal?.trim().slice(0, 280) ||
    undefined;

  if (!summary && focusAreas.length === 0) {
    const t = stored.trim();
    return t ? { summary: t.slice(0, 280) } : {};
  }

  return {
    summary,
    focusAreas: focusAreas.length > 0 ? focusAreas : undefined,
    knownTopics: undefined,
    experienceLevel: undefined,
  };
}

export function mergeMentoredPersonalization(
  base: MentoredPersonalization,
  extra: MentoredPersonalization
): MentoredPersonalization {
  const known = new Set([
    ...(base.knownTopics ?? []),
    ...(extra.knownTopics ?? []),
  ]);
  const focus = new Set([
    ...(base.focusAreas ?? []),
    ...(extra.focusAreas ?? []),
  ]);
  return {
    summary: base.summary?.trim() || extra.summary?.trim() || undefined,
    experienceLevel: base.experienceLevel ?? extra.experienceLevel,
    knownTopics: known.size > 0 ? [...known] : undefined,
    focusAreas: focus.size > 0 ? [...focus] : undefined,
  };
}

export function isPersonalizationEmpty(p: MentoredPersonalization): boolean {
  return (
    !p.summary?.trim() &&
    !(p.knownTopics?.length ?? 0) &&
    !(p.focusAreas?.length ?? 0) &&
    !p.experienceLevel
  );
}
