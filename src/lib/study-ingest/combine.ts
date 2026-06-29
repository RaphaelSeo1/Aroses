import type { ExtractedStudyContent } from "@/lib/study-ingest/extract";

/**
 * Delimiter that prefixes each source's text when several files are combined
 * into one job. Downstream budgeting (`truncateMaterial` in study-generation)
 * splits on this marker to give EVERY source an equal, fair share of the
 * character budget — so a small image transcription can never crowd out a long
 * PDF/transcript that happens to come after it. Keep the format in sync with
 * `SOURCE_BLOCK_MARKER_RE` in `src/lib/ai/study-generation.ts`.
 */
export function combinedSourceMarker(
  index: number,
  total: number,
  label: string
): string {
  return `===== SOURCE ${index}/${total} — FILE: ${label} =====`;
}

export function combineExtractedSources(
  parts: ExtractedStudyContent[]
): { plainText: string; retainStorage: boolean } {
  if (parts.length === 0) {
    throw new Error("No files to process.");
  }
  if (parts.length === 1) {
    return {
      plainText: parts[0].plainText,
      retainStorage: Boolean(parts[0].meta.retainStorage),
    };
  }

  const total = parts.length;
  // Equal-weight instruction + explicit per-source delimiters so the model (and
  // the fair budget allocator) treats the upload as the UNION of every source
  // regardless of type. Without this, a mix (e.g. one screenshot + a PDF
  // transcript) could let whichever source came first dominate while the rest
  // was skimmed or truncated away.
  const header =
    `=== COMBINED STUDY MATERIALS: ${total} SOURCES (EQUAL WEIGHT) ===\n` +
    `These ${total} sources were uploaded together for ONE course. Treat EVERY source as equally important regardless of its type (PDF, image/screenshot, slides, transcript, text). The course must cover the UNION of ALL sources below — never let one source (e.g. an image) dominate or suppress another (e.g. a PDF or transcript). Mine each source as hard as the cleanest one.`;

  const blocks = parts.map((p, i) => {
    const label = `${p.meta.fileName} [${p.meta.kind}]`;
    return `${combinedSourceMarker(i + 1, total, label)}\n${p.plainText.trim()}`;
  });

  const retainStorage = parts.some((p) => Boolean(p.meta.retainStorage));

  return {
    plainText: `${header}\n\n${blocks.join("\n\n")}`,
    retainStorage,
  };
}
