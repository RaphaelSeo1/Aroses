import {
  markdownToNoteNodes,
  noteNodesToMarkdown,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";

/**
 * Wrap-up consistency review plumbing (server-side, pure JSON).
 *
 * On Finish — once, before course generation — every fully-AI note section
 * is checked against the full transcript by one Haiku call
 * (`reviewLiveLectureNotes`). These helpers extract the reviewable sections
 * from the stored TipTap doc and splice accepted revisions back in.
 *
 * Student-owned content is untouchable: any section containing a block with
 * provenance `ai-edited` or null is excluded from review entirely.
 */

type PmDoc = { type?: string; content?: NoteNodeJson[] };

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
    if (!isAiOwned(node)) excluded.add(sid);
    if (!groups.has(sid)) {
      groups.set(sid, []);
      order.push(sid);
    }
    groups.get(sid)!.push(node);
  }

  return order
    .filter((id) => !excluded.has(id))
    .map((id) => ({ sectionId: id, markdown: noteNodesToMarkdown(groups.get(id)!) }))
    .filter((s) => s.markdown.trim().length > 0);
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
