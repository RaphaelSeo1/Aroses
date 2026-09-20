import {
  markdownToNoteNodes,
  noteNodesToMarkdown,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";
import {
  splitCanonicalMarkdown,
  type CanonicalDraftSection,
} from "@/lib/live-notes/canonical-synthesis";

/**
 * Wrap-up consistency review plumbing (server-side, pure JSON).
 *
 * On Finish — once, before course generation — the editable AI draft is
 * rebuilt from the complete source bundle. These helpers extract ownership,
 * preserve student blocks, and replace or revise AI sections in TipTap JSON.
 *
 * Student-owned content is untouchable: any section containing a block with
 * provenance `ai-edited` or null is excluded from review entirely.
 */

/** Stable section id for the end-of-lecture exam-morning summary. */
export const LECTURE_SUMMARY_SECTION_ID = "lecture-summary";

type PmDoc = {
  type?: string;
  content?: NoteNodeJson[];
  attrs?: Record<string, unknown> & { roseLectureRecap?: string };
};

function topLevelNodes(notesJson: unknown): NoteNodeJson[] {
  const doc = notesJson as PmDoc | null;
  return doc && Array.isArray(doc.content) ? doc.content : [];
}

function sectionIdOf(node: NoteNodeJson): string | null {
  const sid = node.attrs?.sectionId;
  return typeof sid === "string" && sid ? sid : null;
}

function isAiOwned(node: NoteNodeJson): boolean {
  const prov = node.attrs?.provenance;
  return prov === "ai" || prov === "ai-context";
}

/** All fully-AI sections (id + markdown), in document order. */
export function collectAiNoteSections(
  notesJson: unknown
): Array<{ sectionId: string; markdown: string }> {
  const order: string[] = [];
  const groups = new Map<string, NoteNodeJson[]>();
  const excluded = new Set<string>();

  for (const node of topLevelNodes(notesJson)) {
    const sid = sectionIdOf(node);
    if (!sid) continue;
    // Lecture summary is generated after review — never feed it back into review.
    if (sid === LECTURE_SUMMARY_SECTION_ID) continue;
    if (!isAiOwned(node)) excluded.add(sid);
    if (!groups.has(sid)) {
      groups.set(sid, []);
      order.push(sid);
    }
    groups.get(sid)!.push(node);
  }

  return order
    .filter((id) => !excluded.has(id))
    .map((id) => ({
      sectionId: id,
      markdown: noteNodesToMarkdown(groups.get(id)!),
    }))
    .filter((s) => s.markdown.trim().length > 0);
}

/** Every addressable section, with ownership retained for canonical synthesis. */
export function collectNoteDraftSections(
  notesJson: unknown
): CanonicalDraftSection[] {
  const order: string[] = [];
  const groups = new Map<string, NoteNodeJson[]>();
  const studentEdited = new Set<string>();
  let unaddressedId: string | null = null;
  topLevelNodes(notesJson).forEach((node, index) => {
    const storedId = sectionIdOf(node);
    if (storedId === LECTURE_SUMMARY_SECTION_ID) return;
    if (node.type === "horizontalRule") {
      unaddressedId = null;
      return;
    }
    if (
      storedId ||
      node.type === "heading" ||
      unaddressedId == null
    ) {
      unaddressedId = storedId ?? `unaddressed:${index.toString(36)}`;
    }
    const sectionId = storedId ?? unaddressedId;
    if (!groups.has(sectionId)) {
      groups.set(sectionId, []);
      order.push(sectionId);
    }
    groups.get(sectionId)!.push(node);
    if (!isAiOwned(node)) studentEdited.add(sectionId);
  });
  return order
    .map((sectionId) => ({
      sectionId,
      markdown: noteNodesToMarkdown(groups.get(sectionId)!),
      studentEdited: studentEdited.has(sectionId),
    }))
    .filter((section) => section.markdown.trim().length > 0);
}

function canonicalSectionId(markdown: string, index: number): string {
  const heading = markdown.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? markdown;
  const seed = `${index}:${heading.toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `canonical:${index.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/**
 * Replace the editable AI draft with one canonical document while leaving
 * student-owned sections untouched. Existing AI notes are discarded as a
 * representation; their source-backed content must be regenerated from the
 * authoritative source bundle by the caller.
 */
export function replaceAiNoteDraft(
  notesJson: unknown,
  canonicalMarkdown: string
): unknown {
  const doc = notesJson as PmDoc | null;
  if (!doc || !Array.isArray(doc.content)) return notesJson;
  const sections = splitCanonicalMarkdown(canonicalMarkdown);
  if (sections.length === 0) return notesJson;

  const ownership = new Map<string, { aiOnly: boolean }>();
  for (const node of doc.content) {
    const sectionId = sectionIdOf(node);
    if (!sectionId || sectionId === LECTURE_SUMMARY_SECTION_ID) continue;
    const current = ownership.get(sectionId) ?? { aiOnly: true };
    if (!isAiOwned(node)) current.aiOnly = false;
    ownership.set(sectionId, current);
  }
  const replaceableIds = new Set(
    [...ownership.entries()]
      .filter(([, owner]) => owner.aiOnly)
      .map(([sectionId]) => sectionId)
  );

  const shouldRemove = (node: NoteNodeJson): boolean => {
    const sectionId = sectionIdOf(node);
    if (sectionId && replaceableIds.has(sectionId)) return true;
    if (!sectionId && isAiOwned(node) && node.type !== "horizontalRule") {
      return true;
    }
    return (
      node.type === "horizontalRule" &&
      node.attrs?.provenance === "ai"
    );
  };
  const firstRemoved = doc.content.findIndex(shouldRemove);
  const kept = doc.content.filter((node) => !shouldRemove(node));
  const insertAt =
    firstRemoved >= 0 ? Math.min(firstRemoved, kept.length) : kept.length;

  const replacement: NoteNodeJson[] = [];
  sections.forEach((markdown, index) => {
    if (index > 0) {
      replacement.push({
        type: "horizontalRule",
        attrs: { provenance: "ai" },
      });
    }
    replacement.push(
      ...markdownToNoteNodes(markdown, {
        sectionId: canonicalSectionId(markdown, index),
        provenance: "ai",
      })
    );
  });
  if (replacement.length === 0) return notesJson;

  const content = [...kept];
  content.splice(insertAt, 0, ...replacement);
  return { ...doc, content };
}

/** Markdown for the Lecture summary / tutor-style recap, if present. */
export function extractLectureSummaryMarkdown(
  notesJson: unknown
): string | null {
  const doc = notesJson as PmDoc | null;
  const fromAttr = doc?.attrs?.roseLectureRecap;
  if (typeof fromAttr === "string" && fromAttr.trim()) {
    return fromAttr.trim();
  }
  // Legacy: short "## Lecture summary" section prepended into the body.
  const nodes = topLevelNodes(notesJson).filter(
    (n) => sectionIdOf(n) === LECTURE_SUMMARY_SECTION_ID
  );
  if (nodes.length === 0) return null;
  const md = noteNodesToMarkdown(nodes).trim();
  return md.length > 0 ? md : null;
}

/**
 * Full live-notes document as markdown for course ingest: recap (if any)
 * plus every section (AI, student, slide-folded). Empty string if nothing.
 */
export function liveNotesToSourceMarkdown(notesJson: unknown): string {
  const recap = extractLectureSummaryMarkdown(notesJson);
  const body = noteNodesToMarkdown(topLevelNodes(notesJson)).trim();
  return [recap, body].filter(Boolean).join("\n\n").trim();
}

function noteNodePlainText(node: NoteNodeJson): string {
  if (typeof node.text === "string") return node.text;
  const children = (node.content ?? []).map((child) =>
    noteNodePlainText(child as NoteNodeJson)
  );
  if (node.type === "tableRow") return children.join("\t");
  return children.filter(Boolean).join("\n");
}

/** Search/preview mirror for a stored TipTap live-notes document. */
export function liveNotesToPlainText(notesJson: unknown): string {
  return topLevelNodes(notesJson)
    .map(noteNodePlainText)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Store a tutor-style lecture recap on the TipTap doc attrs (not in the
 * live notes body). Replaces any prior recap.
 */
export function setLectureRecapMarkdown(
  notesJson: unknown,
  markdown: string
): unknown {
  const trimmed = markdown.trim();
  if (!trimmed) return notesJson;
  const doc = notesJson as PmDoc | null;
  const content =
    doc && Array.isArray(doc.content)
      ? doc.content
      : [{ type: "paragraph" } as NoteNodeJson];
  return {
    type: "doc",
    attrs: {
      ...(doc?.attrs ?? {}),
      roseLectureRecap: trimmed.slice(0, 40_000),
    },
    content,
  };
}

/**
 * Prepend (or replace) a short Lecture summary section at the top of the
 * notes doc. Prefer `setLectureRecapMarkdown` for tutor-style recaps.
 */
export function prependLectureSummary(
  notesJson: unknown,
  markdown: string
): unknown {
  const replacement = markdownToNoteNodes(markdown, {
    sectionId: LECTURE_SUMMARY_SECTION_ID,
    provenance: "ai",
  });
  if (replacement.length === 0) return notesJson;

  const doc = notesJson as PmDoc | null;
  const existing = doc && Array.isArray(doc.content) ? doc.content : [];
  const withoutSummary = existing.filter(
    (n) => sectionIdOf(n) !== LECTURE_SUMMARY_SECTION_ID
  );
  // Drop a lone empty leading paragraph so the summary sits at the top.
  const rest =
    withoutSummary.length === 1 &&
    withoutSummary[0]?.type === "paragraph" &&
    !(withoutSummary[0].content && withoutSummary[0].content.length)
      ? []
      : withoutSummary;

  const divider: NoteNodeJson = { type: "horizontalRule" };
  return {
    type: "doc",
    ...(doc?.attrs ? { attrs: doc.attrs } : {}),
    content: [...replacement, divider, ...rest],
  };
}

/**
 * Replace revised sections and optionally remove absorbed section ids.
 * Only fully-AI sections may be replaced or removed. Returns a new doc;
 * the input is not mutated.
 */
export function applyNoteRevisions(
  notesJson: unknown,
  revisions: Array<{ sectionId: string; markdown: string }>,
  removeSectionIds: string[] = []
): unknown {
  const doc = notesJson as PmDoc | null;
  if (!doc || !Array.isArray(doc.content)) {
    return notesJson;
  }
  if (revisions.length === 0 && removeSectionIds.length === 0) {
    return notesJson;
  }

  let content = [...doc.content];

  for (const revision of revisions) {
    const indices: number[] = [];
    content.forEach((node, i) => {
      if (sectionIdOf(node) === revision.sectionId) indices.push(i);
    });
    if (indices.length === 0) continue;
    // Only fully-AI sections may be replaced (defense in depth — the
    // review call was already restricted to them).
    if (indices.some((i) => !isAiOwned(content[i]!))) continue;

    const replacement = markdownToNoteNodes(revision.markdown, {
      sectionId: revision.sectionId,
      provenance: "ai",
    });
    if (replacement.length === 0) continue;

    // Rebuild around the first occurrence: replacement goes where the
    // section started; any other blocks of the section are dropped.
    const first = indices[0]!;
    const indexSet = new Set(indices);
    const rebuilt: NoteNodeJson[] = [];
    for (let i = 0; i < content.length; i++) {
      if (i === first) {
        rebuilt.push(...replacement);
        continue;
      }
      if (indexSet.has(i)) continue;
      rebuilt.push(content[i]!);
    }
    content = rebuilt;
  }

  if (removeSectionIds.length > 0) {
    const remove = new Set(removeSectionIds);
    // Never remove a section that still has a pending revision target, or
    // that contains student-edited / non-AI blocks.
    const blocked = new Set<string>();
    for (const node of content) {
      const sid = sectionIdOf(node);
      if (!sid || !remove.has(sid)) continue;
      if (!isAiOwned(node)) blocked.add(sid);
    }
    for (const r of revisions) remove.delete(r.sectionId);
    for (const id of blocked) remove.delete(id);

    if (remove.size > 0) {
      content = content.filter((node) => {
        const sid = sectionIdOf(node);
        return !(sid && remove.has(sid));
      });
    }
  }

  return { ...doc, content };
}
