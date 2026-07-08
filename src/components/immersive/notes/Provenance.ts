import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Block-level provenance + section identity for AI-generated notes.
 *
 * Top-level blocks carry two attributes:
 *   - `provenance`:
 *       "ai"         — appended by the live note-taker (stamped on insert)
 *       "ai-context" — AI-added context the lecturer did NOT say (rendered
 *                      visually distinct; still AI-owned for revision)
 *       "ai-edited"  — an AI block the student later touched (edits are
 *                      final: never auto-revised)
 *       null         — student-authored (or predating this extension)
 *   - `sectionId`: all blocks streamed by one synthesis call share one id.
 *     This is the addressing unit for bounded self-revision.
 *
 * A ProseMirror plugin watches user transactions and flips
 * `ai / ai-context → ai-edited` on any block whose content changed, so
 * wrap-up can weight student edits and revision can skip them. AI writes
 * set `AI_APPEND_META` on their transactions to avoid stamping themselves.
 *
 * A second plugin renders revision-state node decorations (fade-out before
 * a section is rewritten, brief highlight after). Decoration targets are
 * addressed by sectionId — not positions — so concurrent student edits can
 * never desync them. Toggled via `REVISION_DECO_META` transaction meta.
 *
 * Persisted inside the TipTap JSON (`data-provenance` / `data-section-id`
 * in HTML) — no extra storage.
 */

export type BlockProvenance = "ai" | "ai-context" | "user" | "ai-edited";

export const AI_APPEND_META = "liveNotesAiAppend";

/**
 * Transaction meta for revision decorations:
 * `{ set?: Record<sectionId, className>, clear?: sectionId[] }`
 */
export const REVISION_DECO_META = "liveNotesRevisionDeco";

export type RevisionDecoMeta = {
  set?: Record<string, string>;
  clear?: string[];
};

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
          sectionId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-section-id"),
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.sectionId === "string" && attrs.sectionId
                ? { "data-section-id": attrs.sectionId }
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
            const prov = node.attrs?.provenance;
            if (prov !== "ai" && prov !== "ai-context") return;
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
      new Plugin<Map<string, string>>({
        key: new PluginKey("noteRevisionDecorations"),
        state: {
          init: () => new Map<string, string>(),
          apply(tr, value) {
            const meta = tr.getMeta(REVISION_DECO_META) as
              | RevisionDecoMeta
              | undefined;
            if (!meta) return value;
            const next = new Map(value);
            if (meta.set) {
              for (const [id, cls] of Object.entries(meta.set)) {
                next.set(id, cls);
              }
            }
            if (meta.clear) {
              for (const id of meta.clear) next.delete(id);
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const map = this.getState(state);
            if (!map || map.size === 0) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              const sid = node.attrs?.sectionId;
              if (typeof sid === "string" && map.has(sid)) {
                decos.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    class: map.get(sid) as string,
                  })
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
