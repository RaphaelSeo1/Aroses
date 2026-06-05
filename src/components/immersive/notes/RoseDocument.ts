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
      /** Chunk IDs already auto-appended — survives refresh and prevents duplicates. */
      roseAppendedChunkIds: {
        default: [] as string[],
      },
    };
  },
});

export type RoseDocAttrs = {
  roseDocTitle?: string;
  roseDocEmoji?: string;
  roseAppendedChunkIds?: string[];
};

export function readRoseDocAttrs(doc: unknown): RoseDocAttrs {
  if (!doc || typeof doc !== "object") return {};
  const attrs = (doc as { attrs?: RoseDocAttrs }).attrs;
  return attrs ?? {};
}

export function readRoseAppendedChunkIds(doc: unknown): string[] {
  const raw = readRoseDocAttrs(doc).roseAppendedChunkIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}
