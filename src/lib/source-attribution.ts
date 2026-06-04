import {
  parseCourseStructurePlan,
  type CourseStructurePlan,
} from "@/lib/ai/course-payload";
import type { CourseModule, SourceRef } from "@/types/course";

/** Chunk metadata persisted on ingest jobs (no full text). */
export type PersistedIngestChunk = {
  id: string;
  sourceFileName: string;
  position: string;
};

export type SourceIndex = {
  chunks: PersistedIngestChunk[];
  plan?: CourseStructurePlan;
};

export function persistIngestChunks(
  chunks: { id: string; sourceFileName: string; position: string }[]
): PersistedIngestChunk[] {
  return chunks.map(({ id, sourceFileName, position }) => ({
    id,
    sourceFileName,
    position,
  }));
}

export function parsePersistedIngestChunks(raw: unknown): PersistedIngestChunk[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedIngestChunk[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const sourceFileName =
      typeof o.sourceFileName === "string" ? o.sourceFileName.trim() : "";
    const position = typeof o.position === "string" ? o.position.trim() : "";
    if (id.length > 0 && sourceFileName.length > 0) {
      out.push({ id, sourceFileName, position: position || "document" });
    }
  }
  return out;
}

export function parseIngestPlan(raw: unknown): CourseStructurePlan | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    return parseCourseStructurePlan(raw);
  } catch {
    return null;
  }
}

function parseSlideNumber(position: string): number | null {
  const m = position.match(/\bslide\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function parsePageNumber(position: string): number | null {
  const m = position.match(/\bpage\s+~?(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function formatNumericRange(label: string, values: number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0) return label;
  if (sorted.length === 1) return `${label} ${sorted[0]}`;

  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = cur;
    prev = cur;
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `${label} ${ranges.join(", ")}`;
}

function formatLocatorForPositions(positions: string[]): string {
  const trimmed = positions.map((p) => p.trim()).filter((p) => p.length > 0);
  if (trimmed.length === 0) return "document";

  const slides = trimmed.map(parseSlideNumber);
  if (slides.every((n) => n !== null)) {
    return formatNumericRange("slides", slides as number[]);
  }

  const pages = trimmed.map(parsePageNumber);
  if (pages.every((n) => n !== null)) {
    return formatNumericRange("pages", pages as number[]);
  }

  const unique = [...new Set(trimmed)];
  if (unique.length === 1) return unique[0]!;
  return unique.join(", ");
}

/** Turn chunk ids into grouped file + locator citations. */
export function deriveSourcesFromChunkIds(
  chunkIds: string[],
  chunksById: Map<string, PersistedIngestChunk>
): SourceRef[] {
  const byFile = new Map<string, string[]>();
  const orderOf = new Map<string, number>();
  let order = 0;

  for (const id of chunkIds) {
    const chunk = chunksById.get(id);
    if (!chunk) continue;
    if (!orderOf.has(chunk.sourceFileName)) {
      orderOf.set(chunk.sourceFileName, order++);
    }
    const list = byFile.get(chunk.sourceFileName) ?? [];
    list.push(chunk.position);
    byFile.set(chunk.sourceFileName, list);
  }

  return [...byFile.entries()]
    .sort(
      ([a], [b]) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0)
    )
    .map(([fileName, positions]) => ({
      fileName,
      locator: formatLocatorForPositions(positions),
    }));
}

function distributeChunksAcrossLessons(
  modules: CourseModule[],
  chunks: PersistedIngestChunk[]
): Map<string, string[]> {
  const slots: { key: string }[] = [];
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      slots.push({ key: `${mod.id}:${li}` });
    }
  }
  const assignment = new Map<string, string[]>();
  if (slots.length === 0 || chunks.length === 0) return assignment;

  const perSlot = Math.max(1, Math.ceil(chunks.length / slots.length));
  let chunkIdx = 0;
  for (const slot of slots) {
    const ids = chunks.slice(chunkIdx, chunkIdx + perSlot).map((c) => c.id);
    chunkIdx += perSlot;
    if (ids.length > 0) assignment.set(slot.key, ids);
  }
  return assignment;
}

/**
 * Attach per-lesson `sources` from the structure plan (index-aligned with
 * generated modules). Falls back to evenly distributing chunks when no plan.
 */
export function attachLessonSources(
  modules: CourseModule[],
  plan: CourseStructurePlan | null,
  chunks: PersistedIngestChunk[],
  fallbackFileName?: string
): CourseModule[] {
  const chunksById = new Map(chunks.map((c) => [c.id, c]));
  const fallbackAssignment =
    plan == null && chunks.length > 0
      ? distributeChunksAcrossLessons(modules, chunks)
      : null;

  return modules.map((mod, mi) => {
    const planMod = plan?.modules[mi];
    return {
      ...mod,
      lessons: mod.lessons.map((lesson, li) => {
        let chunkIds = planMod?.lessons[li]?.source_chunk_ids ?? [];
        if (chunkIds.length === 0 && fallbackAssignment) {
          chunkIds = fallbackAssignment.get(`${mod.id}:${li}`) ?? [];
        }

        let sources = deriveSourcesFromChunkIds(chunkIds, chunksById);
        if (
          sources.length === 0 &&
          fallbackFileName &&
          fallbackFileName.trim().length > 0
        ) {
          sources = [
            {
              fileName: fallbackFileName.trim(),
              locator: "document",
            },
          ];
        }

        if (sources.length === 0) return lesson;
        return { ...lesson, sources };
      }),
    };
  });
}

export function formatSourceRefs(sources: SourceRef[]): string {
  return sources
    .map((s) =>
      s.locator === "document"
        ? s.fileName
        : `${s.fileName} (${s.locator})`
    )
    .join(" · ");
}
