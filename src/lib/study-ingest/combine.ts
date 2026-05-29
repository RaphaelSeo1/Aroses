import type { ExtractedStudyContent } from "@/lib/study-ingest/extract";

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

  const header = `=== Combined study materials (${parts.length} files) ===\n`;
  const body = parts.map((p) => p.plainText).join("\n\n---\n\n");
  const retainStorage = parts.some((p) => p.meta.retainStorage);

  return {
    plainText: header + body,
    retainStorage,
  };
}
