"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { STUDY_CHAT_PREFILL_EVENT } from "@/components/StudyChatDrawer";

export const LESSON_QUOTE_EVENT = "aroses-lesson-quote";
export const LESSON_HAS_NOTE_QUERY_EVENT = "aroses-lesson-has-note-query";
export const LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT =
  "aroses-lesson-highlight-remove-from-notes";
export const LESSON_HIGHLIGHT_RESTORE_EVENT = "aroses-lesson-highlight-restore";

export type LessonHighlightRestoreDetail = {
  lessonIndex: number;
  entries: Array<{ text: string; color: LessonHighlightColor }>;
};

export type LessonHighlightRemoveFromNotesDetail = {
  lessonIndex: number;
  text: string;
  color?: LessonHighlightColor;
};

export type LessonHighlightColor =
  | "pink"
  | "yellow"
  | "blue"
  | "green"
  | "purple";

export type LessonQuoteDetail = {
  lessonIndex: number;
  text: string;
  color?: LessonHighlightColor;
  action?: "highlight" | "remove-highlight" | "remove-highlight-and-note";
};

/**
 * Synchronous query: the notes panel for this lesson mutates `hasNote` in-place
 * before `dispatchEvent` returns so the highlight menu can decide whether to
 * show the "keep note / remove both / cancel" confirmation step.
 */
export type LessonHasNoteQueryDetail = {
  lessonIndex: number;
  hasNote: boolean;
};

const MIN_CHARS = 2;
const COLORS: Array<{ key: LessonHighlightColor; label: string; bg: string }> = [
  { key: "pink", label: "Pink", bg: "#fce7f3" },
  { key: "yellow", label: "Yellow", bg: "#fef3c7" },
  { key: "blue", label: "Blue", bg: "#dbeafe" },
  { key: "green", label: "Green", bg: "#dcfce7" },
  { key: "purple", label: "Purple", bg: "#ede9fe" },
];

// Block-level tags. A multi-line selection (heading + bullets) produces one
// "block" per matching ancestor; each block becomes its own chip entry so
// users can delete a single line from the notes textarea and only that one
// line's on-page highlight disappears.
const BLOCK_TAG_NAMES = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "FIGURE",
  "PRE",
  "TD",
  "TH",
  "DT",
  "DD",
  "DIV",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "MAIN",
]);

function findBlockAncestor(node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  while (el && el !== el.ownerDocument?.body) {
    if (BLOCK_TAG_NAMES.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return el;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getBlockText(rootEl: HTMLElement, blockId: string): string {
  const marks = Array.from(
    rootEl.querySelectorAll<HTMLElement>(
      `[data-lesson-highlight-block-id="${blockId}"]`
    )
  );
  return normalizeWhitespace(
    marks.map((m) => m.textContent ?? "").join(" ")
  );
}

function readSelection(root: HTMLElement): { text: string; range: Range } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const text = sel.toString().replace(/\u00a0/g, " ").trim();
  if (text.length < MIN_CHARS) return null;

  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  if (!el || !root.contains(el)) return null;

  return { text, range: range.cloneRange() };
}

type AppliedHighlight = {
  ok: boolean;
  groupId: string;
  blocks: Array<{ text: string; blockId: string }>;
};

function applyInlineHighlight(
  range: Range,
  color: LessonHighlightColor
): AppliedHighlight {
  const debugText = range.toString().slice(0, 80);
  const groupId = generateId("g");
  console.log("[highlight] applyInlineHighlight start", {
    color,
    text: debugText,
    groupId,
  });

  // Container must survive unwrapping AND must be an ancestor of every block
  // we're about to wrap. Walk past any existing highlight marks.
  let containerEl: Element | null =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as Element);
  while (containerEl?.matches("[data-lesson-highlight-color]")) {
    containerEl = containerEl.parentElement;
  }
  if (!containerEl) {
    console.warn("[highlight] aborting — no stable ancestor container");
    return { ok: false, groupId, blocks: [] };
  }

  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      const intersects =
        range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
      return intersects ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  if (textNodes.length === 0) {
    console.warn("[highlight] aborting — no intersecting text nodes; keeping existing highlight intact");
    return { ok: false, groupId, blocks: [] };
  }

  // Group text nodes by their nearest block ancestor. Each group becomes ONE
  // chip entry with its own block-id so that deleting one line from notes
  // only removes that line's on-page highlight.
  const groupedByBlock = new Map<HTMLElement, Text[]>();
  for (const node of textNodes) {
    const block = findBlockAncestor(node) ?? (containerEl as HTMLElement);
    const arr = groupedByBlock.get(block) ?? [];
    arr.push(node);
    groupedByBlock.set(block, arr);
  }

  // Pre-assign block-ids so we can attach the SAME id to every wrap call for
  // text nodes inside that block.
  const blockIds = new Map<HTMLElement, string>();
  for (const block of groupedByBlock.keys()) {
    blockIds.set(block, generateId("b"));
  }

  // Unwrap existing marks (without normalizing) so the captured text node refs
  // remain alive.
  const existing = collectIntersectingHighlights(range);
  console.log("[highlight] unwrapping existing marks", existing.length);
  for (const mark of existing.reverse()) {
    unwrapElement(mark, { normalize: false });
  }

  // Wrap each text node, tagging it with its block + group ids.
  const blocksOut: Array<{ text: string; blockId: string }> = [];
  for (const [block, nodes] of groupedByBlock) {
    const blockId = blockIds.get(block)!;
    const wrappedTexts: string[] = [];
    for (const node of [...nodes].reverse()) {
      if (!node.isConnected) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === startContainer) {
        part.setStart(node, Math.min(startOffset, node.nodeValue?.length ?? 0));
      }
      if (node === endContainer) {
        part.setEnd(node, Math.min(endOffset, node.nodeValue?.length ?? 0));
      }
      const wrapped = wrapTextRange(part, color, blockId, groupId);
      if (wrapped) wrappedTexts.push(wrapped);
    }
    if (wrappedTexts.length > 0) {
      const blockText = normalizeWhitespace(
        wrappedTexts.reverse().join(" ")
      );
      if (blockText) blocksOut.push({ text: blockText, blockId });
    }
  }

  console.log(
    "[highlight] wrapped",
    textNodes.length,
    "text node(s) across",
    blocksOut.length,
    "block(s) in",
    color
  );
  return { ok: blocksOut.length > 0, groupId, blocks: blocksOut };
}

function collectIntersectingHighlights(range: Range): HTMLElement[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as Element);
  if (!root) return [];
  const marks = new Set<HTMLElement>();
  for (const node of [range.startContainer, range.endContainer]) {
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    for (
      let current = el?.closest<HTMLElement>("[data-lesson-highlight-color]");
      current;
      current = current.parentElement?.closest<HTMLElement>(
        "[data-lesson-highlight-color]"
      ) ?? null
    ) {
      marks.add(current);
    }
  }
  for (const mark of Array.from(
    root.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
  )) {
    marks.add(mark);
  }
  return Array.from(marks).filter((mark) => {
    const markRange = document.createRange();
    markRange.selectNodeContents(mark);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, markRange) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, markRange) > 0
    );
  });
}

function wrapTextRange(
  range: Range,
  color: LessonHighlightColor,
  blockId?: string,
  groupId?: string
): string | null {
  const raw = range.toString();
  if (!raw.trim()) return null;
  const bg = COLORS.find((c) => c.key === color)?.bg ?? "#fef3c7";
  const mark = document.createElement("mark");
  mark.dataset.lessonHighlightColor = color;
  if (blockId) mark.dataset.lessonHighlightBlockId = blockId;
  if (groupId) mark.dataset.lessonHighlightGroupId = groupId;
  mark.style.backgroundColor = bg;
  mark.style.color = "inherit";
  mark.style.borderRadius = "0.2rem";
  mark.style.padding = "0 0.08em";
  mark.style.boxDecorationBreak = "clone";
  // `webkitBoxDecorationBreak` isn't in the standard CSSStyleDeclaration
  // type. Set via setProperty to stay strict-TS compatible.
  mark.style.setProperty("-webkit-box-decoration-break", "clone");

  try {
    range.surroundContents(mark);
  } catch {
    mark.textContent = raw;
    range.deleteContents();
    range.insertNode(mark);
  }
  return raw.trim();
}

function getRelatedMarks(
  mark: HTMLElement,
  scope: "block" | "group"
): HTMLElement[] {
  const outer = getOutermostHighlight(mark);
  const root = outer.ownerDocument;
  if (!root) return [outer];
  const id =
    scope === "block"
      ? outer.dataset.lessonHighlightBlockId
      : outer.dataset.lessonHighlightGroupId;
  if (!id) {
    // Legacy mark: fall back to nested children.
    return [
      outer,
      ...Array.from(
        outer.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
      ),
    ];
  }
  const attr =
    scope === "block"
      ? "data-lesson-highlight-block-id"
      : "data-lesson-highlight-group-id";
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[${attr}="${id}"]`)
  );
}

function recolorHighlightInPlace(
  mark: HTMLElement,
  color: LessonHighlightColor
) {
  const bg = COLORS.find((c) => c.key === color)?.bg ?? "#fef3c7";
  // Recolor the entire selection group (all blocks created together), not
  // just the single block. This preserves the UX of "I made one highlight,
  // let me change its color."
  const related = getRelatedMarks(mark, "group");
  for (const node of related) {
    node.dataset.lessonHighlightColor = color;
    node.style.backgroundColor = bg;
  }
  console.log("[highlight] recolored", related.length, "mark(s) in place to", color);
}

function collectNestedHighlightText(mark: HTMLElement): string[] {
  return [
    mark.textContent?.trim() ?? "",
    ...Array.from(
      mark.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
    ).map((node) => node.textContent?.trim() ?? ""),
  ].filter(Boolean);
}

function getOutermostHighlight(mark: HTMLElement): HTMLElement {
  let current = mark;
  let parent = current.parentElement?.closest<HTMLElement>(
    "[data-lesson-highlight-color]"
  );
  while (parent) {
    current = parent;
    parent = current.parentElement?.closest<HTMLElement>(
      "[data-lesson-highlight-color]"
    );
  }
  return current;
}

function removeInlineHighlight(mark: HTMLElement) {
  // Page-side "Remove highlight" removes the entire visual block the user
  // clicked. For multi-line selections, each block is independent — clicking
  // on the "Body temperature" mark only removes its block, leaving siblings
  // alone (the user can remove those via their own chips / clicks).
  const targets = getRelatedMarks(mark, "block");
  for (const target of targets) {
    const outer = getOutermostHighlight(target);
    if (!outer.isConnected) continue;
    for (const nested of Array.from(
      outer.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
    ).reverse()) {
      unwrapElement(nested);
    }
    unwrapElement(outer);
  }
}

function unwrapElement(
  mark: HTMLElement,
  options: { normalize?: boolean } = { normalize: true }
) {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  if (options.normalize !== false) parent.normalize();
}

function dispatchQuote(detail: LessonQuoteDetail) {
  window.dispatchEvent(
    new CustomEvent<LessonQuoteDetail>(LESSON_QUOTE_EVENT, {
      detail,
    })
  );
}

type TextPart = { node: Text; text: string; globalStart: number };

function collectHighlightableTextParts(root: HTMLElement): {
  parts: TextPart[];
  combined: string;
} {
  const parts: TextPart[] = [];
  let combined = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("[data-lesson-highlight-color]")) continue;
    const text = node.textContent ?? "";
    if (!text) continue;
    parts.push({ node, text, globalStart: combined.length });
    combined += text;
  }
  return { parts, combined };
}

function findTextSpan(
  combined: string,
  searchText: string
): { start: number; end: number } | null {
  const target = searchText.trim();
  if (target.length < MIN_CHARS) return null;

  const exact = combined.indexOf(target);
  if (exact >= 0) {
    return { start: exact, end: exact + target.length };
  }

  const normTarget = normalizeWhitespace(target);
  for (let start = 0; start < combined.length; start++) {
    for (let end = start + normTarget.length; end <= combined.length; end++) {
      if (normalizeWhitespace(combined.slice(start, end)) === normTarget) {
        return { start, end };
      }
      const sliceNorm = normalizeWhitespace(combined.slice(start, end));
      if (sliceNorm.length > normTarget.length) break;
    }
  }
  return null;
}

function rangeFromSpan(parts: TextPart[], start: number, end: number): Range | null {
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const { node, text, globalStart } of parts) {
    const globalEnd = globalStart + text.length;
    if (!startNode && start >= globalStart && start < globalEnd) {
      startNode = node;
      startOffset = start - globalStart;
    }
    if (end > globalStart && end <= globalEnd) {
      endNode = node;
      endOffset = end - globalStart;
      break;
    }
    if (start < globalEnd && end > globalEnd) {
      endNode = node;
      endOffset = text.length;
    }
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function isTextAlreadyHighlighted(root: HTMLElement, searchText: string): boolean {
  const target = normalizeWhitespace(searchText);
  if (!target) return false;
  const marks = root.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]");
  for (const mark of marks) {
    const markText = normalizeWhitespace(mark.textContent ?? "");
    if (markText === target || markText.includes(target)) return true;
  }
  return false;
}

function restoreSavedHighlights(
  root: HTMLElement,
  entries: Array<{ text: string; color: LessonHighlightColor }>
) {
  for (const entry of entries) {
    const text = entry.text.trim();
    if (text.length < MIN_CHARS) continue;
    if (isTextAlreadyHighlighted(root, text)) continue;

    const { parts, combined } = collectHighlightableTextParts(root);
    const span = findTextSpan(combined, text);
    if (!span) {
      console.warn("[highlight] restore miss — text not found in lesson", {
        text: text.slice(0, 80),
      });
      continue;
    }
    const range = rangeFromSpan(parts, span.start, span.end);
    if (!range) continue;
    const result = applyInlineHighlight(range, entry.color);
    if (!result.ok) {
      console.warn("[highlight] restore wrap failed", {
        text: text.slice(0, 80),
        color: entry.color,
      });
    }
  }
}

/**
 * Wraps lesson bodies in read mode; selected text is sent to {@link LESSON_QUOTE_EVENT}
 * for the matching lesson’s notes panel.
 */
export function LessonQuoteCaptureRegion({
  lessonIndex,
  enabled = true,
  className,
  children,
}: {
  lessonIndex: number;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{ text: string; range: Range } | null>(null);
  const activeMarkRef = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<{
    top: number;
    left: number;
    text: string;
    mode: "selection" | "existing" | "confirm-remove";
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;

    const showSelectionMenu = () => {
      const hit = readSelection(root);
      if (!hit) return;
      const rect = hit.range.getBoundingClientRect();
      pendingRef.current = hit;
      activeMarkRef.current = null;
      setMenu({
        text: hit.text,
        mode: "selection",
        top: Math.max(8, rect.top - 44),
        left: Math.min(
          window.innerWidth - 260,
          Math.max(8, rect.left)
        ),
      });
    };

    const onMouseUp = () => showSelectionMenu();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      const el =
        target instanceof HTMLElement
          ? target
          : target instanceof Text
            ? target.parentElement
            : null;
      if (!el) return;
      const mark = el.closest<HTMLElement>("[data-lesson-highlight-color]");
      if (!mark || !root.contains(mark)) return;
      const rect = mark.getBoundingClientRect();
      pendingRef.current = null;
      activeMarkRef.current = mark;
      setMenu({
        text: mark.textContent?.trim() ?? "Highlighted text",
        mode: "existing",
        top: Math.max(8, rect.top - 44),
        left: Math.min(window.innerWidth - 220, Math.max(8, rect.left)),
      });
    };

    const onTouchEnd = () => {
      window.setTimeout(showSelectionMenu, 50);
    };

    const onRemoveFromNotes = (ev: Event) => {
      const ce = ev as CustomEvent<LessonHighlightRemoveFromNotesDetail>;
      const d = ce.detail;
      if (!d || d.lessonIndex !== lessonIndex) return;
      const target = d.text.replace(/\s+/g, " ").trim();
      if (!target) return;
      const rootEl = ref.current;
      if (!rootEl) return;

      // 1) Block-id path (new highlights): each chip == one block. Find the
      //    block whose joined text matches exactly and remove only that
      //    block's marks. This is what makes "delete the title line from
      //    notes" remove ONLY the title's on-page highlight.
      const blocksSeen = new Set<string>();
      const blockMatches: string[] = [];
      const allMarks = Array.from(
        rootEl.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
      );
      for (const m of allMarks) {
        if (!m.isConnected) continue;
        if (d.color && m.dataset.lessonHighlightColor !== d.color) continue;
        const blockId = m.dataset.lessonHighlightBlockId;
        if (!blockId || blocksSeen.has(blockId)) continue;
        blocksSeen.add(blockId);
        const blockText = getBlockText(rootEl, blockId);
        if (blockText === target) blockMatches.push(blockId);
      }

      let removed = 0;
      if (blockMatches.length > 0) {
        for (const blockId of blockMatches) {
          const marks = Array.from(
            rootEl.querySelectorAll<HTMLElement>(
              `[data-lesson-highlight-block-id="${blockId}"]`
            )
          );
          for (const m of marks) {
            const outer = getOutermostHighlight(m);
            if (!outer.isConnected) continue;
            for (const nested of Array.from(
              outer.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
            ).reverse()) {
              unwrapElement(nested);
            }
            unwrapElement(outer);
            removed += 1;
          }
        }
      } else {
        // 2) Legacy path (marks without block-id, or chip text spans multiple
        //    blocks from older sessions): exact-text first, substring fallback.
        const exact: HTMLElement[] = [];
        const partial: HTMLElement[] = [];
        for (const mark of allMarks) {
          if (!mark.isConnected) continue;
          if (d.color && mark.dataset.lessonHighlightColor !== d.color) continue;
          const markText = (mark.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (!markText) continue;
          if (markText === target) {
            exact.push(mark);
          } else if (
            markText.length > 1 &&
            target.length > 2 &&
            target.includes(markText)
          ) {
            partial.push(mark);
          }
        }
        const toRemove = exact.length > 0 ? exact : partial;
        for (const mark of toRemove) {
          const outer = getOutermostHighlight(mark);
          if (!outer.isConnected) continue;
          // Use the legacy nested-only removal so we don't accidentally
          // cascade to sibling blocks via block-id (these are legacy marks).
          for (const nested of Array.from(
            outer.querySelectorAll<HTMLElement>("[data-lesson-highlight-color]")
          ).reverse()) {
            unwrapElement(nested);
          }
          unwrapElement(outer);
          removed += 1;
        }
        console.log(
          "[highlight] remove-from-notes legacy fallback",
          { exact: exact.length, partial: partial.length, removed, target }
        );
      }

      console.log(
        "[highlight] remove-from-notes done",
        { blockMatches: blockMatches.length, removed, target }
      );
      if (activeMarkRef.current && !activeMarkRef.current.isConnected) {
        activeMarkRef.current = null;
        setMenu(null);
      }
    };

    const onRestore = (ev: Event) => {
      const ce = ev as CustomEvent<LessonHighlightRestoreDetail>;
      const d = ce.detail;
      if (!d || d.lessonIndex !== lessonIndex) return;
      const rootEl = ref.current;
      if (!rootEl || d.entries.length === 0) return;
      window.requestAnimationFrame(() => {
        if (!ref.current) return;
        console.log("[highlight] restoring saved highlights", {
          lessonIndex,
          count: d.entries.length,
        });
        restoreSavedHighlights(ref.current, d.entries);
      });
    };

    root.addEventListener("mouseup", onMouseUp);
    root.addEventListener("click", onClick);
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener(
      LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT,
      onRemoveFromNotes
    );
    window.addEventListener(LESSON_HIGHLIGHT_RESTORE_EVENT, onRestore);
    return () => {
      root.removeEventListener("mouseup", onMouseUp);
      root.removeEventListener("click", onClick);
      root.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener(
        LESSON_HIGHLIGHT_REMOVE_FROM_NOTES_EVENT,
        onRemoveFromNotes
      );
      window.removeEventListener(LESSON_HIGHLIGHT_RESTORE_EVENT, onRestore);
    };
  }, [enabled, lessonIndex]);

  const chooseHighlight = (color: LessonHighlightColor) => {
    const activeMark = activeMarkRef.current
      ? getOutermostHighlight(activeMarkRef.current)
      : null;

    // Recolor an existing highlight in place: zero DOM unwrap/rewrap, so the
    // highlight cannot accidentally disappear. Recolors the entire group
    // (all blocks created together), and dispatches one chip update per block
    // so each per-block chip flips to the new color label cleanly.
    if (activeMark && menu?.mode === "existing") {
      const previousColor =
        (activeMark.dataset.lessonHighlightColor as
          | LessonHighlightColor
          | undefined) ?? null;
      console.log("[highlight] recolor request", {
        from: previousColor,
        to: color,
      });
      try {
        recolorHighlightInPlace(activeMark, color);
        const rootEl = ref.current;
        const groupMarks = getRelatedMarks(activeMark, "group");
        const blockTexts = new Map<string, string>();
        for (const m of groupMarks) {
          const blockId = m.dataset.lessonHighlightBlockId;
          if (!blockId || !rootEl) continue;
          if (blockTexts.has(blockId)) continue;
          const t = getBlockText(rootEl, blockId);
          if (t) blockTexts.set(blockId, t);
        }
        if (blockTexts.size > 0) {
          for (const text of blockTexts.values()) {
            dispatchQuote({
              lessonIndex,
              text,
              color,
              action: "highlight",
            });
          }
        } else {
          // Legacy mark with no block-id: fall back to single dispatch.
          const text =
            activeMark.textContent?.trim() ?? menu?.text ?? "";
          if (text) {
            dispatchQuote({
              lessonIndex,
              text,
              color,
              action: "highlight",
            });
          }
        }
      } catch (error) {
        console.error(
          "[highlight] recolor failed, leaving original color intact",
          error
        );
      }
      activeMarkRef.current = null;
      pendingRef.current = null;
      setMenu(null);
      return;
    }

    const pending = pendingRef.current;
    if (!pending) return;
    console.log("[highlight] new highlight request", {
      color,
      text: pending.text,
    });
    const result = applyInlineHighlight(pending.range, color);
    if (!result.ok || result.blocks.length === 0) {
      console.warn(
        "[highlight] visual wrap failed; saving note only with fallback text"
      );
      dispatchQuote({
        lessonIndex,
        text: pending.text,
        color,
        action: "highlight",
      });
    } else {
      // One chip entry per block. Each chip becomes independently editable
      // and removable, so deleting one line from notes only removes that
      // line's highlight on the page.
      for (const block of result.blocks) {
        dispatchQuote({
          lessonIndex,
          text: block.text,
          color,
          action: "highlight",
        });
      }
    }
    window.getSelection()?.removeAllRanges();
    pendingRef.current = null;
    activeMarkRef.current = null;
    setMenu(null);
  };

  const askAi = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    window.dispatchEvent(
      new CustomEvent(STUDY_CHAT_PREFILL_EVENT, {
        detail: {
          text: `Can you explain this selected text in simpler terms?\n\n"${pending.text}"`,
        },
      })
    );
    window.getSelection()?.removeAllRanges();
    pendingRef.current = null;
    activeMarkRef.current = null;
    setMenu(null);
  };

  const performRemove = (alsoRemoveNote: boolean) => {
    const mark = activeMarkRef.current
      ? getOutermostHighlight(activeMarkRef.current)
      : null;
    if (!mark) {
      console.warn("[highlight] performRemove called with no active mark");
      setMenu(null);
      return;
    }
    const rootEl = ref.current;
    const color = mark.dataset.lessonHighlightColor as
      | LessonHighlightColor
      | undefined;
    const blockId = mark.dataset.lessonHighlightBlockId;
    // Capture the block's full text BEFORE unwrapping so the notes side can
    // exact-match against the per-block chip.
    let texts: string[];
    if (blockId && rootEl) {
      const blockText = getBlockText(rootEl, blockId);
      texts = blockText ? [blockText] : collectNestedHighlightText(mark);
    } else {
      texts = collectNestedHighlightText(mark);
    }
    console.log("[highlight] removing highlight", {
      texts,
      blockId,
      color,
      alsoRemoveNote,
    });
    removeInlineHighlight(mark);
    const action: LessonQuoteDetail["action"] = alsoRemoveNote
      ? "remove-highlight-and-note"
      : "remove-highlight";
    for (const text of texts) {
      dispatchQuote({ lessonIndex, text, color, action });
    }
    activeMarkRef.current = null;
    setMenu(null);
  };

  const removeHighlight = () => {
    const mark = activeMarkRef.current
      ? getOutermostHighlight(activeMarkRef.current)
      : null;
    if (!mark) {
      setMenu(null);
      return;
    }

    // Synchronously ask the notes panel whether this lesson has a saved note
    // body. The listener mutates `detail.hasNote` before dispatchEvent returns.
    const query: LessonHasNoteQueryDetail = { lessonIndex, hasNote: false };
    window.dispatchEvent(
      new CustomEvent<LessonHasNoteQueryDetail>(LESSON_HAS_NOTE_QUERY_EVENT, {
        detail: query,
      })
    );
    console.log("[highlight] remove requested", { hasNote: query.hasNote });

    if (!query.hasNote) {
      performRemove(false);
      return;
    }

    // There's a note attached — surface the 3-option confirm before mutating.
    const rect = mark.getBoundingClientRect();
    setMenu({
      mode: "confirm-remove",
      text: mark.textContent?.trim() ?? menu?.text ?? "",
      top: Math.max(8, rect.top - 44),
      left: Math.min(window.innerWidth - 320, Math.max(8, rect.left)),
    });
  };

  const cancelRemove = () => {
    console.log("[highlight] remove cancelled");
    activeMarkRef.current = null;
    setMenu(null);
  };

  return (
    <>
      <div ref={ref} className={className}>
        {children}
      </div>
      {menu ? (
        <div
          className="fixed z-[120] flex max-w-[min(26rem,calc(100vw-1rem))] flex-wrap items-center gap-1 rounded-2xl border border-zinc-200/90 bg-white/95 p-1.5 text-xs shadow-xl shadow-zinc-900/10 backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/95 dark:shadow-black/40"
          style={{ top: menu.top, left: menu.left }}
          onMouseDown={(e) => e.preventDefault()}
          role="menu"
          aria-label={`Actions for selected text: ${menu.text.slice(0, 80)}`}
        >
          {menu.mode === "confirm-remove" ? (
            <>
              <span className="px-2 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                This highlight has a note attached.
              </span>
              <button
                type="button"
                onClick={() => performRemove(false)}
                className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                Keep note
              </button>
              <button
                type="button"
                onClick={() => performRemove(true)}
                className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-500"
              >
                Remove both
              </button>
              <button
                type="button"
                onClick={cancelRemove}
                className="rounded-full px-2.5 py-1 font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  onClick={() => chooseHighlight(color.key)}
                  className="rounded-full px-2.5 py-1 font-semibold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  style={{ backgroundColor: color.bg }}
                >
                  {color.label}
                </button>
              ))}
              {menu.mode === "selection" ? (
                <button
                  type="button"
                  onClick={askAi}
                  className="rounded-full bg-zinc-900 px-2.5 py-1 font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Ask AI
                </button>
              ) : (
                <button
                  type="button"
                  onClick={removeHighlight}
                  className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"
                >
                  Remove highlight
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              pendingRef.current = null;
              activeMarkRef.current = null;
              setMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close highlight menu"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
