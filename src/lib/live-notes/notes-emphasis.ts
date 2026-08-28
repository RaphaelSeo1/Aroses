/**
 * Live-lecture wrap-up: pull student writing (and edits to AI blocks) plus
 * the AI-notes heading outline out of a Live Notes TipTap doc.
 *
 * These become emphasis signals in the ingest job's `study_context` — extra
 * lesson/quiz weight and a structure hint. Notes, transcript, and slides are
 * all packed into the ingest blob as first-class sources.
 */

/** Stable token so outline/module prompts can inject live-lecture source rules. */
export const LIVE_LECTURE_CONTEXT_MARKER =
  "LIVE LECTURE SOURCES: notes + transcript + slides";

type PmNode = {
  type?: string;
  text?: string;
  attrs?: { provenance?: unknown; level?: unknown };
  content?: PmNode[];
};

function nodeText(node: PmNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(nodeText).join(" ").replace(/\s+/g, " ").trim();
}

export type LiveNotesEmphasis = {
  /** Student-authored or student-edited lines (highest priority signal). */
  studentLines: string[];
  /** AI section headings, in lecture order (structure hint). */
  aiHeadings: string[];
};

export function extractLiveNotesEmphasis(notesJson: unknown): LiveNotesEmphasis {
  const studentLines: string[] = [];
  const aiHeadings: string[] = [];

  const doc = notesJson as PmNode | null;
  if (!doc || !Array.isArray(doc.content)) {
    return { studentLines, aiHeadings };
  }

  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const provenance =
      typeof node.attrs?.provenance === "string" ? node.attrs.provenance : null;
    const text = nodeText(node);

    if (provenance === "ai" || provenance === "ai-context") {
      // "ai-context" is AI-added clarification the lecturer never said —
      // it is neither student emphasis nor lecture structure.
      if (provenance === "ai" && node.type === "heading" && text) {
        aiHeadings.push(text.slice(0, 120));
      }
      continue;
    }

    // null (student-authored / pre-extension) and "ai-edited" both count as
    // the student's voice. Skip AI boilerplate headings that slipped through.
    if (!text || text.length < 3) continue;
    if (node.type === "horizontalRule") continue;
    studentLines.push(text.slice(0, 300));
  }

  return {
    studentLines: studentLines.slice(0, 30),
    aiHeadings: aiHeadings.slice(0, 25),
  };
}

export function isLiveLectureStudyContext(stored: string): boolean {
  return stored.includes(LIVE_LECTURE_CONTEXT_MARKER);
}

/**
 * Injected into outline + module + course prompts via `generationContextSuffix`.
 * Notes, transcript, and slides are all first-class; overlap is taught once.
 */
export function formatLiveLectureGenerationBlock(stored: string): string {
  if (!isLiveLectureStudyContext(stored)) return "";
  return `=== LIVE LECTURE SOURCES (first-class — not transcript-only) ===
The MATERIAL is a merge of labeled sources: \`[from … notes]\`, \`[from … transcript]\`, \`[from … slides]\`, and possibly \`[from … screen]\` / \`[from … handout]\`. Generated notes, speech transcript, and uploaded slides/deck are EQUAL primary sources. On-screen extracts and chat-attached PDFs are additional session material — use them too. None of these is "the only source."

THOROUGHNESS:
- Cover the UNION of unique teachable content. Include slide pages, tables, and formulas the lecturer never spoke, AND spoken explanations, worked examples, and asides that never appeared on slides.
- Use the generated notes as the structured merge (they may already fold slide content in), but do not skip unique slide pages or unique spoken points just because they are missing from the notes.
- Walk slides end to end. A unique slide that was never discussed is still in scope.

DE-DUPLICATION (critical):
- When the same concept appears in notes AND transcript AND slides, teach it ONCE at the richest version. Fuse: slide tables/formulas + note structure + spoken explanation into a single lesson.
- Do NOT copy the same table, definition, or fact three times. One complete rendering is enough.
- Prefer slides/screen for tables, numbers, spellings, and formulas; prefer the transcript for verbal reasoning and "why it matters"; prefer the notes for heading/structure. Merge, do not repeat.
=== END LIVE LECTURE SOURCES ===`;
}

/**
 * Compose the `study_context` blob for the wrap-up ingest job. Uses the
 * standard self-study blob format so `formatSelfStudyGenerationBlock`
 * renders it into every outline/module prompt unchanged.
 *
 * Pass `liveLectureSources: true` from course wrap-up so generation always
 * sees the three-source + de-dupe rules even when the student wrote nothing.
 */
export function buildLiveNotesStudyContext(input: {
  emphasis: LiveNotesEmphasis;
  lectureTitle: string;
  liveLectureSources?: boolean;
}): string {
  const { studentLines, aiHeadings } = input.emphasis;
  const live = Boolean(input.liveLectureSources);
  if (!live && studentLines.length === 0 && aiHeadings.length === 0) return "";

  const goalParts: string[] = [];
  if (live) {
    goalParts.push(
      LIVE_LECTURE_CONTEXT_MARKER,
      "Build the course from ALL of: (1) generated notes including slide-folded content, (2) the speech transcript, (3) uploaded lecture slides/deck and any on-screen extracts or chat handouts. Thorough coverage of unique content; when the same idea appears in more than one source, include it once at the richest version (slide tables/formulas + note structure + spoken explanation) — do not teach the same table or fact twice."
    );
  }
  if (studentLines.length > 0) {
    goalParts.push(
      "STUDENT NOTES & EDITS taken live during the lecture (give these topics extra lessons, examples, and quiz weight):",
      ...studentLines.map((l) => `• ${l}`)
    );
  }
  if (aiHeadings.length > 0) {
    goalParts.push(
      "LECTURE STRUCTURE HINT (section headings in teaching order — prefer a module/lesson flow that mirrors this):",
      ...aiHeadings.map((h) => `• ${h}`)
    );
  }

  const summary = live
    ? `Live-captured lecture. ${LIVE_LECTURE_CONTEXT_MARKER}. First-class sources are generated notes (including slide-folded content), the speech transcript, and uploaded slides/deck (plus on-screen extracts or chat handouts when present). Cover unique slide pages that were never spoken and unique spoken content that is not on slides. Student-written lines below still get extra lesson and quiz weight.`
    : "Notes converted to a course. Student-written lines below get extra lesson and quiz weight.";

  const lines: string[] = [
    `TITLE: ${input.lectureTitle.slice(0, 150)}`,
    `SUMMARY: ${summary}`,
  ];
  if (studentLines.length > 0) {
    lines.push("FOCUS AREAS:");
    for (const l of studentLines.slice(0, 12)) {
      lines.push(`- ${l.slice(0, 160)}`);
    }
  }
  if (goalParts.length > 0) {
    lines.push("FULL GOAL (student's words):", goalParts.join("\n"));
  }

  return lines.join("\n").slice(0, 4000);
}
