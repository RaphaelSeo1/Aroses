/**
 * Live-lecture wrap-up: pull student writing (and edits to AI blocks) plus
 * the AI-notes heading outline out of a Live Notes TipTap doc.
 *
 * These become emphasis signals in the ingest job's `study_context` — extra
 * lesson/quiz weight and a structure hint. The generated notes themselves
 * are also packed into the ingest source blob next to the transcript.
 */

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

/**
 * Compose the `study_context` blob for the wrap-up ingest job. Uses the
 * standard self-study blob format so `formatSelfStudyGenerationBlock`
 * renders it into every outline/module prompt unchanged.
 */
export function buildLiveNotesStudyContext(input: {
  emphasis: LiveNotesEmphasis;
  lectureTitle: string;
}): string {
  const { studentLines, aiHeadings } = input.emphasis;
  if (studentLines.length === 0 && aiHeadings.length === 0) return "";

  const goalParts: string[] = [];
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

  const lines: string[] = [
    `TITLE: ${input.lectureTitle.slice(0, 150)}`,
    "SUMMARY: Live-captured lecture. Source material is BOTH the generated notes (including slide content folded into those notes) AND the speech transcript. Student-written lines below still get extra lesson and quiz weight.",
  ];
  if (studentLines.length > 0) {
    lines.push("FOCUS AREAS:");
    for (const l of studentLines.slice(0, 12)) {
      lines.push(`- ${l.slice(0, 160)}`);
    }
  }
  lines.push("FULL GOAL (student's words):", goalParts.join("\n"));

  return lines.join("\n").slice(0, 4000);
}
