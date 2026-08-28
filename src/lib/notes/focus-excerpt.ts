import type { Node as PmNode } from "@tiptap/pm/model";

const MIN_DIRECT_CHARS = 12;
const SHORT_SELECTION_CHARS = 80;

export type FocusExcerpt = {
  /** Text sent to quiz generation. */
  corpus: string;
  /** Short preview shown in confirmations. */
  preview: string;
  /** True when we expanded a collapsed caret to the surrounding heading section. */
  usedSection: boolean;
};

/**
 * Build a quiz-generation corpus from a notes selection, or the heading
 * section under a collapsed caret.
 */
export function buildFocusExcerpt(opts: {
  doc: PmNode;
  from: number;
  to: number;
}): FocusExcerpt {
  const { doc, from, to } = opts;
  const selected = from < to ? doc.textBetween(from, to, "\n").trim() : "";
  const terms = collectEmphasisTerms(doc, from, to);

  if (selected.length >= MIN_DIRECT_CHARS) {
    const parent = parentBlockText(doc, from);
    const needsContext =
      selected.length < SHORT_SELECTION_CHARS &&
      parent.length > selected.length + 8;
    const focusLines =
      terms.length > 0 && !terms.every((t) => selected.includes(t))
        ? terms
        : selected.length < SHORT_SELECTION_CHARS
          ? [selected]
          : [];
    let corpus = selected;
    if (needsContext) {
      const focus =
        focusLines.length > 0 ? focusLines.join("; ") : selected;
      corpus = `FOCUS ON: ${focus}\n\nCONTEXT:\n${parent}`;
    } else if (terms.length > 0 && selected.length >= SHORT_SELECTION_CHARS) {
      corpus = `FOCUS ON: ${terms.join("; ")}\n\n${selected}`;
    }
    return { corpus, preview: selected, usedSection: false };
  }

  const section = currentSectionText(doc, from);
  if (section.length >= MIN_DIRECT_CHARS) {
    return { corpus: section, preview: clipPreview(section), usedSection: true };
  }

  const fallback = doc.textBetween(0, Math.min(doc.content.size, 4_000), "\n").trim();
  return {
    corpus: fallback,
    preview: clipPreview(fallback),
    usedSection: true,
  };
}

function clipPreview(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function collectEmphasisTerms(doc: PmNode, from: number, to: number): string[] {
  if (from >= to) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText || !node.text) return true;
    const marked = node.marks.some(
      (m) => m.type.name === "bold" || m.type.name === "highlight"
    );
    if (!marked) return true;
    const t = node.text.trim();
    const key = t.toLowerCase();
    if (t.length >= 2 && t.length <= 80 && !seen.has(key)) {
      seen.add(key);
      found.push(t);
    }
    return true;
  });
  return found.slice(0, 8);
}

function parentBlockText(doc: PmNode, pos: number): string {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  const depth = $pos.depth;
  for (let d = depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.isTextblock || node.type.name === "heading") {
      return node.textContent.trim();
    }
  }
  return $pos.parent.textContent.trim();
}

function currentSectionText(doc: PmNode, pos: number): string {
  const clamped = Math.min(Math.max(pos, 0), doc.content.size);
  type Block = { from: number; to: number; node: PmNode };
  const blocks: Block[] = [];
  doc.forEach((node, offset) => {
    blocks.push({ from: offset, to: offset + node.nodeSize, node });
  });
  if (blocks.length === 0) return "";

  let startIdx = 0;
  let startLevel = 99;
  let foundHeading = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.from > clamped) break;
    if (b.node.type.name === "heading") {
      startIdx = i;
      startLevel = typeof b.node.attrs.level === "number" ? b.node.attrs.level : 2;
      foundHeading = true;
    } else if (!foundHeading && clamped >= b.from && clamped <= b.to) {
      startIdx = i;
    }
  }

  if (!foundHeading) {
    const b = blocks[startIdx]!;
    return doc.textBetween(b.from, b.to, "\n").trim();
  }

  let endIdx = blocks.length;
  for (let i = startIdx + 1; i < blocks.length; i++) {
    const n = blocks[i]!.node;
    if (n.type.name === "heading") {
      const lvl = typeof n.attrs.level === "number" ? n.attrs.level : 2;
      if (lvl <= startLevel) {
        endIdx = i;
        break;
      }
    }
  }

  const from = blocks[startIdx]!.from;
  const to = blocks[endIdx - 1]!.to;
  return doc.textBetween(from, to, "\n").trim();
}
