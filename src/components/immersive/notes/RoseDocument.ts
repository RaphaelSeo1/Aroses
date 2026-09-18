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
      /**
       * Tutor-style end-of-lecture recap markdown (generated on Finish).
       * Shown via the Lecture summary button — not mixed into the live notes body.
       */
      roseLectureRecap: {
        default: "",
      },
      /**
       * Uploaded-deck page count whose slide-by-slide source-coverage audit
       * (and repair) already completed for these notes. Lets a reload skip
       * re-auditing — and respects lines the student deleted afterwards.
       */
      roseSourceCoverageCheckedPages: {
        default: 0,
      },
    };
  },
});

export type RoseDocAttrs = {
  roseDocTitle?: string;
  roseDocEmoji?: string;
  roseAppendedChunkIds?: string[];
  roseLectureRecap?: string;
  roseSourceCoverageCheckedPages?: number;
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
