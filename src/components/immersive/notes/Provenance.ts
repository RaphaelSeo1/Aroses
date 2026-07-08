import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Block-level provenance for Live Notes.
 *
 * Top-level blocks carry a `provenance` attribute:
 *   - "ai"        — appended by the live note-taker (stamped on insert)
 *   - "ai-edited" — an AI block the student later touched
 *   - null        — student-authored (or predating this extension)
 *
 * A ProseMirror plugin watches user transactions and flips `ai → ai-edited`
 * on any block whose content changed, so wrap-up can weight student edits.
 * AI appends set `AI_APPEND_META` on their transaction to avoid stamping
 * themselves as edits.
 *
 * Persisted inside the TipTap JSON (`data-provenance` in HTML) — no extra
 * storage. Hosts that never stamp "ai" (mentored / tutor notes) are
 * unaffected: the attribute stays null everywhere.
 */

export type BlockProvenance = "ai" | "user" | "ai-edited";

export const AI_APPEND_META = "liveNotesAiAppend";

/** Top-level block types that can carry provenance. */
export const PROVENANCE_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "callout",
  "horizontalRule",
];

export const Provenance = Extension.create({
  name: "blockProvenance",

  addGlobalAttributes() {
    return [
      {
        types: PROVENANCE_BLOCK_TYPES,
        attributes: {
          provenance: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-provenance"),
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.provenance === "string" && attrs.provenance
                ? { "data-provenance": attrs.provenance }
                : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockProvenanceTracker"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          // AI appends (and our own follow-up transactions) are not edits.
          if (transactions.some((t) => t.getMeta(AI_APPEND_META))) return null;

          // Collect changed ranges in end-of-transaction coordinates.
          const ranges: Array<[number, number]> = [];
          for (const t of transactions) {
            if (!t.docChanged) continue;
            t.mapping.maps.forEach((stepMap, i) => {
              stepMap.forEach((_fromA, _toA, fromB, toB) => {
                let from = fromB;
                let to = toB;
                for (let j = i + 1; j < t.mapping.maps.length; j++) {
                  from = t.mapping.maps[j].map(from);
                  to = t.mapping.maps[j].map(to);
                }
                ranges.push([from, to]);
              });
            });
          }
          if (ranges.length === 0) return null;

          let tr: typeof newState.tr | null = null;
          newState.doc.forEach((node, offset) => {
            if (node.attrs?.provenance !== "ai") return;
            const start = offset;
            const end = offset + node.nodeSize;
            const touched = ranges.some(([f, t2]) => f < end && t2 > start);
            if (touched) {
              tr = tr ?? newState.tr;
              tr.setNodeMarkup(offset, undefined, {
                ...node.attrs,
                provenance: "ai-edited",
              });
            }
          });
          if (tr) {
            // Never re-enter for our own attribute-only transaction.
            (tr as typeof newState.tr).setMeta(AI_APPEND_META, true);
          }
          return tr;
        },
      }),
    ];
  },
});
