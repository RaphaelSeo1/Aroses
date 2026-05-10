export type ExploreOutlineMaterial = {
  fileName: string;
  materialSort: number;
  modules: { id: number; title: string }[];
};

export type ExploreOutlineGroup = {
  name: string;
  sort: number;
  materials: ExploreOutlineMaterial[];
};

type RpcRow = {
  examGroupName: string;
  examGroupSort: number;
  fileName: string;
  materialSort: number;
  modules: { id: number; title: string }[] | null;
};

function parseOutlineRows(raw: unknown): ExploreOutlineGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const rows = raw as RpcRow[];
  const groupOrder: number[] = [];
  const map = new Map<
    number,
    { name: string; materials: ExploreOutlineMaterial[] }
  >();

  for (const r of rows) {
    const sort = Number(r.examGroupSort);
    if (!map.has(sort)) {
      map.set(sort, { name: String(r.examGroupName ?? "Materials"), materials: [] });
      groupOrder.push(sort);
    }
    const g = map.get(sort)!;
    g.materials.push({
      fileName: String(r.fileName ?? "Material"),
      materialSort: Number(r.materialSort) || 0,
      modules: Array.isArray(r.modules)
        ? r.modules.map((m) => ({
            id: typeof m.id === "number" ? m.id : Number(m.id) || 0,
            title: typeof m.title === "string" ? m.title : "Module",
          }))
        : [],
    });
  }

  groupOrder.sort((a, b) => a - b);

  return groupOrder.map((sort) => {
    const g = map.get(sort)!;
    g.materials.sort((a, b) => a.materialSort - b.materialSort);
    return {
      name: g.name,
      sort,
      materials: g.materials,
    };
  });
}

/** True when the public outline includes at least one module title. */
export function exploreOutlineHasModules(groups: ExploreOutlineGroup[]): boolean {
  return groups.some((g) =>
    g.materials.some((m) => m.modules.length > 0)
  );
}

/** Parses JSON returned by `explore_course_outline` RPC (migration 009). */
export function exploreOutlineFromRpcPayload(raw: unknown): ExploreOutlineGroup[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseOutlineRows(parsed);
    } catch {
      return [];
    }
  }
  return parseOutlineRows(raw);
}
