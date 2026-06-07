import type { CourseStructurePlan } from "@/lib/ai/course-payload";
import type { PersistedIngestChunk, SourceIndex } from "@/lib/source-attribution";
import { parsePageNumbersFromPosition } from "@/lib/study-ingest/chunk-position";
import { isFullPageRenderImage } from "@/lib/study-ingest/source-images/is-page-render";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";
import type { CourseModule } from "@/types/course";

export type FigureAssignment = {
  moduleId: number;
  lessonIndex: number;
  figureIds: string[];
};

export type FiguresIndex = {
  figures: IngestSourceImageRecord[];
  assignments: FigureAssignment[];
};

function parseSlideNumber(position: string): number | null {
  const m = position.match(/\bslide\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function parseSectionNumber(position: string): number | null {
  const m = position.match(/\bsection\s+(\d+)\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function filesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function imageMatchesChunkExactly(
  img: IngestSourceImageRecord,
  chunk: PersistedIngestChunk
): boolean {
  if (!filesMatch(img.sourceFileName, chunk.sourceFileName)) return false;

  const slide = parseSlideNumber(chunk.position);
  if (
    slide !== null &&
    img.anchorType === "slide" &&
    img.anchorIndex === slide
  ) {
    return true;
  }

  const pages = parsePageNumbersFromPosition(chunk.position);
  if (
    pages.length > 0 &&
    img.anchorType === "page" &&
    pages.includes(img.anchorIndex)
  ) {
    return true;
  }

  return false;
}

function maxAnchorForFile(
  images: IngestSourceImageRecord[],
  fileName: string,
  type: "page" | "slide"
): number {
  let max = 0;
  for (const img of images) {
    if (!filesMatch(img.sourceFileName, fileName)) continue;
    if (img.anchorType === type && img.anchorIndex > max) max = img.anchorIndex;
  }
  return max;
}

function maxSectionForFile(chunks: PersistedIngestChunk[], fileName: string): number {
  let max = 0;
  for (const c of chunks) {
    if (!filesMatch(c.sourceFileName, fileName)) continue;
    const s = parseSectionNumber(c.position);
    if (s !== null && s > max) max = s;
  }
  return max;
}

function proportionalPageMatchesSection(
  img: IngestSourceImageRecord,
  chunk: PersistedIngestChunk,
  pageMax: number,
  sectionMax: number
): boolean {
  if (img.anchorType !== "page" || pageMax <= 0 || sectionMax <= 0) return false;
  const section = parseSectionNumber(chunk.position);
  if (section === null) return false;
  if (!filesMatch(img.sourceFileName, chunk.sourceFileName)) return false;

  const imgSlot = Math.min(
    sectionMax - 1,
    Math.max(0, Math.floor(((img.anchorIndex - 1) / pageMax) * sectionMax))
  );
  return section - 1 === imgSlot;
}

type LessonSlot = {
  key: string;
  moduleId: number;
  lessonIndex: number;
  chunkIds: string[];
};

function collectLessonSlots(
  modules: CourseModule[],
  plan: CourseStructurePlan | null,
  chunks: PersistedIngestChunk[]
): LessonSlot[] {
  const fallbackAssignment =
    plan == null && chunks.length > 0
      ? distributeChunkIdsAcrossLessons(modules, chunks)
      : null;

  const slots: LessonSlot[] = [];
  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi]!;
    const planModule = plan?.modules[mi];
    for (let li = 0; li < mod.lessons.length; li++) {
      let chunkIds = planModule?.lessons[li]?.source_chunk_ids ?? [];
      if (chunkIds.length === 0 && fallbackAssignment) {
        chunkIds = fallbackAssignment.get(`${mod.id}:${li}`) ?? [];
      }
      slots.push({
        key: `${mod.id}:${li}`,
        moduleId: mod.id,
        lessonIndex: li,
        chunkIds,
      });
    }
  }
  return slots;
}

function distributeChunkIdsAcrossLessons(
  modules: CourseModule[],
  chunks: PersistedIngestChunk[]
): Map<string, string[]> {
  const slots: string[] = [];
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      slots.push(`${mod.id}:${li}`);
    }
  }
  const assignment = new Map<string, string[]>();
  if (slots.length === 0 || chunks.length === 0) return assignment;

  const perSlot = Math.max(1, Math.ceil(chunks.length / slots.length));
  let chunkIdx = 0;
  for (const key of slots) {
    const ids = chunks.slice(chunkIdx, chunkIdx + perSlot).map((c) => c.id);
    chunkIdx += perSlot;
    if (ids.length > 0) assignment.set(key, ids);
  }
  return assignment;
}

/**
 * Map extracted upload figures to lessons using the structure plan + chunk
 * positions (slide/page). Unmatched figures fall back to proportional assignment.
 */
export function assignFiguresToLessons(
  modules: CourseModule[],
  sourceImages: IngestSourceImageRecord[],
  sourceIndex: SourceIndex | null
): Map<string, IngestSourceImageRecord[]> {
  const result = new Map<string, IngestSourceImageRecord[]>();
  const cropsOnly = sourceImages.filter(
    (img) => img.url && !isFullPageRenderImage(img)
  );
  if (!cropsOnly.length || !modules.length) return result;

  const chunks = sourceIndex?.chunks ?? [];
  const plan = sourceIndex?.plan ?? null;
  const chunksById = new Map(chunks.map((c) => [c.id, c]));
  const used = new Set<string>();

  const slots = collectLessonSlots(modules, plan, chunks);

  for (const slot of slots) {
    const matched: IngestSourceImageRecord[] = [];
    for (const cid of slot.chunkIds) {
      const chunk = chunksById.get(cid);
      if (!chunk) continue;
      for (const img of cropsOnly) {
        if (used.has(img.id)) continue;
        if (!filesMatch(img.sourceFileName, chunk.sourceFileName)) continue;
        if (imageMatchesChunkExactly(img, chunk)) {
          matched.push(img);
          used.add(img.id);
        }
      }
    }
    if (matched.length > 0) {
      result.set(slot.key, matched);
    }
  }

  // PDF: page-anchored figures ↔ section-anchored chunks (same file).
  for (const slot of slots) {
    if (result.has(slot.key)) continue;
    const matched: IngestSourceImageRecord[] = [];
    for (const cid of slot.chunkIds) {
      const chunk = chunksById.get(cid);
      if (!chunk) continue;
      const pageMax = maxAnchorForFile(
        cropsOnly,
        chunk.sourceFileName,
        "page"
      );
      const sectionMax = maxSectionForFile(chunks, chunk.sourceFileName);
      if (pageMax <= 0 || sectionMax <= 0) continue;

      for (const img of cropsOnly) {
        if (used.has(img.id)) continue;
        if (
          proportionalPageMatchesSection(img, chunk, pageMax, sectionMax)
        ) {
          matched.push(img);
          used.add(img.id);
        }
      }
    }
    if (matched.length > 0) {
      result.set(slot.key, matched);
    }
  }

  const unassigned = cropsOnly.filter((img) => !used.has(img.id));
  if (unassigned.length === 0) return result;

  // Document-level / leftover figures: spread across lessons that share the file.
  const slotsByFile = new Map<string, LessonSlot[]>();
  for (const slot of slots) {
    for (const cid of slot.chunkIds) {
      const chunk = chunksById.get(cid);
      if (!chunk) continue;
      const arr = slotsByFile.get(chunk.sourceFileName) ?? [];
      if (!arr.some((s) => s.key === slot.key)) arr.push(slot);
      slotsByFile.set(chunk.sourceFileName, arr);
    }
  }

  for (const img of unassigned) {
    const fileSlots =
      slotsByFile.get(img.sourceFileName) ??
      (img.anchorType === "document" ? slots : []);
    if (fileSlots.length === 0) {
      continue;
    }
    const target =
      fileSlots.find((s) => !result.has(s.key)) ??
      fileSlots[Math.min(
        fileSlots.length - 1,
        Math.max(
          0,
          img.anchorIndex > 0
            ? Math.floor(
                ((img.anchorIndex - 1) /
                  Math.max(
                    1,
                    maxAnchorForFile(
                      cropsOnly,
                      img.sourceFileName,
                      img.anchorType === "slide" ? "slide" : "page"
                    )
                  )) *
                  fileSlots.length
              )
            : 0
        )
      )]!;
    const arr = result.get(target.key) ?? [];
    arr.push(img);
    result.set(target.key, arr);
    used.add(img.id);
  }

  // Last resort: round-robin any still-unassigned figures across all lessons.
  const stillLeft = cropsOnly.filter((img) => !used.has(img.id));
  if (stillLeft.length > 0 && slots.length > 0) {
    let si = 0;
    for (const img of stillLeft) {
      const slot = slots[si % slots.length]!;
      const arr = result.get(slot.key) ?? [];
      arr.push(img);
      result.set(slot.key, arr);
      si++;
    }
  }

  return result;
}

export function buildFiguresIndex(
  modules: CourseModule[],
  sourceImages: IngestSourceImageRecord[],
  assignment: Map<string, IngestSourceImageRecord[]>
): FiguresIndex {
  const assignments: FigureAssignment[] = [];
  for (const mod of modules) {
    for (let li = 0; li < mod.lessons.length; li++) {
      const imgs = assignment.get(`${mod.id}:${li}`);
      if (!imgs?.length) continue;
      assignments.push({
        moduleId: mod.id,
        lessonIndex: li,
        figureIds: imgs.map((i) => i.id),
      });
    }
  }
  return { figures: sourceImages, assignments };
}
