import type { SupabaseClient } from "@supabase/supabase-js";
import type { FiguresIndex } from "@/lib/figure-attribution";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

/**
 * Runtime reader for `study_materials.figures_index` — the per-lesson catalog
 * of figures/page-renders extracted from the upload at ingest time. This data
 * is written at finalize but was previously never read by the app; Mentored
 * Learning uses it to show the student the ACTUAL figure from their PDF while
 * Rose teaches, instead of a generic web image.
 *
 * Lesson figures are keyed by 0-based `lessonIndex` within a module so the
 * runner can look up `chunk.sourceLessonIndex` directly.
 */
export type LessonFiguresByIndex = Record<number, IngestSourceImageRecord[]>;

function isSourceImageRecord(v: unknown): v is IngestSourceImageRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.url === "string" &&
    typeof o.sourceFileName === "string" &&
    typeof o.label === "string" &&
    (o.anchorType === "slide" ||
      o.anchorType === "page" ||
      o.anchorType === "document") &&
    typeof o.anchorIndex === "number" &&
    typeof o.mimeType === "string"
  );
}

/** Validate/rehydrate a `figures_index` JSONB value into a typed FiguresIndex. */
export function parseFiguresIndex(raw: unknown): FiguresIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.figures) || !Array.isArray(o.assignments)) return null;

  const figures = o.figures.filter(isSourceImageRecord);
  if (figures.length === 0) return null;

  const assignments = o.assignments.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (
      typeof r.moduleId !== "number" ||
      typeof r.lessonIndex !== "number" ||
      !Array.isArray(r.figureIds)
    ) {
      return [];
    }
    const figureIds = r.figureIds.filter(
      (id): id is string => typeof id === "string"
    );
    return [{ moduleId: r.moduleId, lessonIndex: r.lessonIndex, figureIds }];
  });

  return { figures, assignments };
}

/**
 * Resolve the figures assigned to each lesson of a given module, keyed by the
 * 0-based lesson index.
 */
export function lessonFiguresForModule(
  index: FiguresIndex,
  moduleId: number
): LessonFiguresByIndex {
  const byId = new Map(index.figures.map((f) => [f.id, f]));
  const out: LessonFiguresByIndex = {};
  for (const a of index.assignments) {
    if (a.moduleId !== moduleId) continue;
    const figs = a.figureIds
      .map((id) => byId.get(id))
      .filter((f): f is IngestSourceImageRecord => f != null);
    if (figs.length > 0) out[a.lessonIndex] = figs;
  }
  return out;
}

/** Whether a figure is a full-page render / slide (good for the page walkthrough). */
export function isPageFigure(fig: IngestSourceImageRecord): boolean {
  return fig.anchorType === "page" || fig.anchorType === "slide";
}

/**
 * Load `figures_index` for a material and return the per-lesson figures for a
 * single module. Returns an empty object when the material has no figures
 * (older courses built before page-render was enabled, text-only uploads, etc.).
 */
export async function loadSourceFiguresForModule(
  supabase: SupabaseClient,
  materialId: string,
  moduleId: number
): Promise<LessonFiguresByIndex> {
  const { data, error } = await supabase
    .from("study_materials")
    .select("figures_index")
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    // Missing column (pre-migration 056) or read error — degrade gracefully.
    return {};
  }
  const index = parseFiguresIndex(
    (data as { figures_index?: unknown } | null)?.figures_index
  );
  if (!index) return {};
  return lessonFiguresForModule(index, moduleId);
}
