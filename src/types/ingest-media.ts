export type IngestTranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type IngestMediaMeta = {
  kind: "audio" | "video";
  bucket: string;
  storagePath: string;
  fileName: string;
  transcriptSegments?: IngestTranscriptSegment[];
};

export function parseIngestMedia(raw: unknown): IngestMediaMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "audio" && r.kind !== "video") return null;
  if (typeof r.bucket !== "string" || typeof r.storagePath !== "string") {
    return null;
  }
  const segments = Array.isArray(r.transcriptSegments)
    ? r.transcriptSegments
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const seg = s as Record<string, unknown>;
          if (typeof seg.text !== "string" || !seg.text.trim()) return null;
          return {
            startSec: typeof seg.startSec === "number" ? seg.startSec : 0,
            endSec: typeof seg.endSec === "number" ? seg.endSec : 0,
            text: seg.text.trim(),
          };
        })
        .filter((x): x is IngestTranscriptSegment => x !== null)
    : undefined;
  return {
    kind: r.kind,
    bucket: r.bucket,
    storagePath: r.storagePath,
    fileName: typeof r.fileName === "string" ? r.fileName : "recording",
    transcriptSegments: segments?.length ? segments : undefined,
  };
}
