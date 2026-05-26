import Document from "@tiptap/extension-document";

/** Doc-level metadata persisted inside the TipTap JSON (title + emoji). */
export const RoseDocument = Document.extend({
  addAttributes() {
    return {
      roseDocTitle: {
        default: "",
      },
      roseDocEmoji: {
        default: "📝",
      },
    };
  },
});

export type RoseDocAttrs = {
  roseDocTitle?: string;
  roseDocEmoji?: string;
};

export function readRoseDocAttrs(doc: unknown): RoseDocAttrs {
  if (!doc || typeof doc !== "object") return {};
  const attrs = (doc as { attrs?: RoseDocAttrs }).attrs;
  return attrs ?? {};
}
