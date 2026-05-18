"use client";

import { mergeAttributes, Node } from "@tiptap/core";

/**
 * Notion-style callout block.
 *
 * Renders as a soft colored box with a leading emoji and editable
 * paragraph content. The emoji is stored on the node attrs and can
 * be cycled by clicking it (handled in the renderer below — via a
 * plain contenteditable=false span with a click handler attached
 * by the ProseMirror view).
 *
 * Schema:
 *   <div data-callout emoji="💡">
 *     <span data-emoji>💡</span>
 *     <div data-content>... block content ...</div>
 *   </div>
 *
 * Block-level, accepts block content. Default emoji is 💡.
 */

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

const DEFAULT_EMOJI = "💡";

export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      emoji: {
        default: DEFAULT_EMOJI,
        parseHTML: (el) => el.getAttribute("data-emoji") || DEFAULT_EMOJI,
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-callout]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-callout": "", class: "tn-callout" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      [
        "span",
        {
          class: "tn-callout-emoji",
          contenteditable: "false",
          "data-emoji": node.attrs.emoji,
        },
        node.attrs.emoji ?? DEFAULT_EMOJI,
      ],
      ["div", { class: "tn-callout-body" }, 0],
    ];
  },
});

export default Callout;
