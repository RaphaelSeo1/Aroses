/**
 * Orders a course's study materials the way a student progresses through them:
 * by section (exam group) order first, then each material's position within its
 * section, with creation time as a stable tiebreak.
 *
 * Used so mentored learning can advance from the last module of one material
 * into the next material/section of the course.
 */

type MaterialRow = {
  id: string;
  exam_group_id?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
};

type GroupRow = {
  id: string;
  sort_order?: number | null;
  created_at?: string | null;
};

function timeOf(value?: string | null): number {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export function orderMaterialIds(
  materials: MaterialRow[],
  groups: GroupRow[]
): string[] {
  const groupRank = new Map<string, number>();
  groups
    .slice()
    .sort(
      (a, b) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
        timeOf(a.created_at) - timeOf(b.created_at)
    )
    .forEach((g, i) => groupRank.set(g.id, i));

  return materials
    .slice()
    .sort((a, b) => {
      const ga = groupRank.get(a.exam_group_id ?? "") ?? Number.MAX_SAFE_INTEGER;
      const gb = groupRank.get(b.exam_group_id ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (ga !== gb) return ga - gb;
      const sa = Number(a.sort_order ?? 0);
      const sb = Number(b.sort_order ?? 0);
      if (sa !== sb) return sa - sb;
      return timeOf(a.created_at) - timeOf(b.created_at);
    })
    .map((m) => m.id);
}
