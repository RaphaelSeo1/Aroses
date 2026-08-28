import type { Node as PmNode } from "@tiptap/pm/model";

/** True for a paragraph with no text and no non-break atoms (images, etc.). */
export function isEmptyParagraph(node: PmNode): boolean {
  if (node.type.name !== "paragraph") return false;
  if (node.textContent.trim().length > 0) return false;
  let hasAtom = false;
  node.forEach((child) => {
    if (child.type.name !== "hardBreak" && !child.isText) hasAtom = true;
  });
  return !hasAtom;
}

/**
 * Range covering one or more empty paragraphs at the end of the doc — the
 * placeholder ProseMirror keeps in a blank document. AI inserts consume this
 * instead of stacking a heading after it (which used to be hidden with CSS
 * that also collapsed student Enter-splits).
 */
export function trailingEmptyParagraphRange(
  doc: PmNode
): { from: number; to: number } | null {
  const ranges: Array<{ from: number; to: number }> = [];
  doc.forEach((node, offset) => {
    ranges.push({ from: offset, to: offset + node.nodeSize });
  });
  let i = ranges.length - 1;
  let from: number | null = null;
  const to = doc.content.size;
  while (i >= 0) {
    const node = doc.child(i);
    if (!isEmptyParagraph(node)) break;
    from = ranges[i]!.from;
    i -= 1;
  }
  if (from == null || from >= to) return null;
  return { from, to };
}
