/**
 * Order study materials the same way as the course dashboard: by section tab
 * order, then `sort_order` within the group (then `created_at` as tiebreaker).
 */
export type MaterialOrderFields = {
  exam_group_id: string;
  sort_order?: number | null;
  created_at: string;
};

export function sortStudyMaterialsForDashboard<T extends MaterialOrderFields>(
  rows: T[],
  examGroupIdsInTabOrder: string[]
): T[] {
  const rank = new Map<string, number>();
  examGroupIdsInTabOrder.forEach((id, i) => rank.set(id, i));

  return [...rows].sort((a, b) => {
    const ra = rank.get(a.exam_group_id) ?? 99999;
    const rb = rank.get(b.exam_group_id) ?? 99999;
    if (ra !== rb) return ra - rb;

    const sa =
      typeof a.sort_order === "number" && Number.isFinite(a.sort_order)
        ? a.sort_order
        : 0;
    const sb =
      typeof b.sort_order === "number" && Number.isFinite(b.sort_order)
        ? b.sort_order
        : 0;
    if (sa !== sb) return sa - sb;

    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
}
