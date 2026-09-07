import {
  noteNodesToMarkdown,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";

export type ExistingNoteSection = {
  sectionId: string;
  markdown: string;
  studentEdited: boolean;
};

const SECTION_PREFIX = "existing:";

function textContent(node: NoteNodeJson): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? [])
    .map((child) => textContent(child as NoteNodeJson))
    .join("");
}

function stableId(node: NoteNodeJson, index: number): string {
  const seed = `${index}:${node.type}:${textContent(node).trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${SECTION_PREFIX}${index.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function isSectionHeading(node: NoteNodeJson): boolean {
  if (node.type !== "heading") return false;
  const level = node.attrs?.level;
  return level === 1 || level === 2 || level == null;
}

/**
 * Give legacy/imported note blocks stable section addresses without changing
 * their provenance. Older material-generated notes predate live-note
 * sectionIds, so they otherwise disappear from synthesis context entirely.
 */
export function addressExistingNoteNodes(nodes: NoteNodeJson[]): {
  nodes: NoteNodeJson[];
  changed: boolean;
} {
  let currentId: string | null = null;
  let changed = false;
  const addressed = nodes.map((node, index) => {
    const existingId = node.attrs?.sectionId;
    if (typeof existingId === "string" && existingId) {
      currentId = existingId;
      return node;
    }
    if (node.type === "horizontalRule") return node;
    if (isSectionHeading(node) || currentId == null) {
      currentId = stableId(node, index);
    }
    changed = true;
    return {
      ...node,
      attrs: { ...(node.attrs ?? {}), sectionId: currentId },
    };
  });
  return { nodes: addressed, changed };
}

/** Collect every addressed section in document order. */
export function collectExistingNoteSections(
  nodes: NoteNodeJson[]
): ExistingNoteSection[] {
  const order: string[] = [];
  const groups = new Map<string, NoteNodeJson[]>();
  const studentEdited = new Set<string>();
  for (const node of nodes) {
    const sectionId = node.attrs?.sectionId;
    if (typeof sectionId !== "string" || !sectionId) continue;
    if (!groups.has(sectionId)) {
      groups.set(sectionId, []);
      order.push(sectionId);
    }
    groups.get(sectionId)!.push(node);
    const provenance = node.attrs?.provenance;
    if (provenance !== "ai" && provenance !== "ai-context") {
      studentEdited.add(sectionId);
    }
  }
  return order
    .map((sectionId) => ({
      sectionId,
      markdown: noteNodesToMarkdown(groups.get(sectionId)!),
      studentEdited: studentEdited.has(sectionId),
    }))
    .filter((section) => section.markdown.trim().length > 0);
}
