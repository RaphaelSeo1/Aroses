import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** Padding added per Tab press, in `em`. */
export const INDENT_STEP_EM = 1.5;
export const MAX_INDENT = 8;

/**
 * Blocks that Tab indents via padding-left. Lists nest instead
 * (`sinkListItem` / `liftListItem`); tables keep cell-to-cell Tab.
 */
export const INDENTABLE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "callout",
  "image",
] as const;

const INDENTABLE = new Set<string>(INDENTABLE_TYPES);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export function clampIndent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_INDENT, Math.round(n)));
}

export function parseIndentAttr(el: HTMLElement): number {
  const data = el.getAttribute("data-indent");
  if (data != null && data !== "") {
    const n = clampIndent(Number(data));
    if (n > 0) return n;
  }
  const pl = el.style.paddingLeft.trim();
  const em = pl.match(/^([\d.]+)em$/i);
  if (em) {
    return clampIndent(Math.round(Number(em[1]) / INDENT_STEP_EM));
  }
  return 0;
}

function collectIndentTargets(tr: Transaction): Array<{ pos: number; node: PmNode }> {
  const { selection } = tr;
  const targets: Array<{ pos: number; node: PmNode }> = [];
  if (selection.empty) {
    const $from = selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (INDENTABLE.has(node.type.name)) {
        targets.push({ pos: $from.before(depth), node });
        break;
      }
    }
    return targets;
  }
  tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!INDENTABLE.has(node.type.name)) return true;
    targets.push({ pos, node });
    return false;
  });
  return targets;
}

function applyIndentDelta(tr: Transaction, delta: number): boolean {
  const targets = collectIndentTargets(tr);
  if (targets.length === 0) return false;
  let changed = false;
  for (const { pos, node } of targets) {
    const current = clampIndent(node.attrs.indent);
    const next = clampIndent(current + delta);
    if (next === current) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
    changed = true;
  }
  return changed;
}

/**
 * Tab indent for non-list notes blocks. Persists as `indent` on the
 * TipTap JSON and as `data-indent` + `padding-left` in HTML.
 */
export const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: [...INDENTABLE_TYPES],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => parseIndentAttr(el),
            renderHTML: (attrs: Record<string, unknown>) => {
              const level = clampIndent(attrs.indent);
              if (level <= 0) return {};
              return {
                "data-indent": String(level),
                style: `padding-left: ${level * INDENT_STEP_EM}em`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return collectIndentTargets(tr).length > 0;
          return applyIndentDelta(tr, 1);
        },
      outdent:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return collectIndentTargets(tr).length > 0;
          return applyIndentDelta(tr, -1);
        },
    };
  },
});

export default Indent;
