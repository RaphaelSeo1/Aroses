"use client";

import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const FOCUS_CLIP_MARK = "focusClip";

export type FocusClipOptions = {
  HTMLAttributes: Record<string, unknown>;
  hint: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    focusClip: {
      setFocusClip: (attrs?: { id?: string | null }) => ReturnType;
      unsetFocusClip: () => ReturnType;
    };
  }
}

function collectFocusClipRanges(
  doc: PmNode
): Array<{ from: number; to: number; id: string | null }> {
  const ranges: Array<{ from: number; to: number; id: string | null }> = [];
  let current: { from: number; to: number; id: string | null } | null = null;

  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((m) => m.type.name === FOCUS_CLIP_MARK);
    if (!mark) {
      if (current) {
        ranges.push(current);
        current = null;
      }
      return true;
    }
    const from = pos;
    const to = pos + node.nodeSize;
    const id = typeof mark.attrs.id === "string" ? mark.attrs.id : null;
    if (current && current.id === id && from <= current.to + 2) {
      current.to = to;
      return true;
    }
    if (current) ranges.push(current);
    current = { from, to, id };
    return true;
  });
  if (current) ranges.push(current);
  return ranges;
}

function makeIconEl(hint: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "tn-focus-clip-icon";
  el.contentEditable = "false";
  el.setAttribute("title", hint);
  el.setAttribute("aria-label", hint);
  el.innerHTML =
    '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M9.15 1.05 3.4 8.7c-.22.28-.02.7.34.7h3.2l-1.55 5.35c-.16.42.4.72.68.37l6.3-7.55c.22-.28.02-.7-.34-.7H8.85l1.05-5.45c.12-.42-.4-.7-.75-.37Z"/></svg>';
  return el;
}

/**
 * Inline mark for a notes passage that was turned into focus questions.
 * Persisted in TipTap JSON; a widget paints a small lightning bolt at the
 * start of each continuous range.
 */
export const FocusClip = Mark.create<FocusClipOptions>({
  name: FOCUS_CLIP_MARK,
  inclusive: false,
  excludes: "",
  spanning: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      hint: "Added to focus questions",
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-focus-clip-id"),
        renderHTML: (attrs) =>
          typeof attrs.id === "string" && attrs.id
            ? { "data-focus-clip-id": attrs.id }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-focus-clip]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-focus-clip": "", class: "tn-focus-clip" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setFocusClip:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetFocusClip:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addProseMirrorPlugins() {
    const hint = this.options.hint;
    return [
      new Plugin({
        key: new PluginKey("focusClipWidgets"),
        props: {
          decorations(state) {
            const ranges = collectFocusClipRanges(state.doc);
            if (ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              ranges.map((r) =>
                Decoration.widget(
                  r.from,
                  () => makeIconEl(hint),
                  {
                    side: -1,
                    ignoreSelection: true,
                    key: `focus-clip:${r.id ?? r.from}`,
                  }
                )
              )
            );
          },
        },
      }),
    ];
  },
});

export function applyFocusClipMark(
  editor: Editor,
  from: number,
  to: number,
  id: string
): boolean {
  const type = editor.schema.marks.focusClip;
  if (!type || editor.isDestroyed) return false;
  const size = editor.state.doc.content.size;
  const start = Math.max(0, Math.min(from, to, size));
  const end = Math.min(size, Math.max(from, to));
  if (start >= end) return false;
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.addMark(start, end, type.create({ id }));
      return true;
    })
    .run();
}

export default FocusClip;
