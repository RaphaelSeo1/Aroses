/**
 * Next lecture after a course-scoped focus quiz: next module in this material,
 * else the first module of the next material in the same exam group/section
 * (sidebar order). Does not auto-advance.
 */

export type NextLectureTarget = {
  materialId: string;
  moduleId: number;
};

export type NextLectureResult =
  | { kind: "lecture"; target: NextLectureTarget }
  | { kind: "section_done" }
  | { kind: "course_done" };

export type NextLectureSidebarMaterial = {
  materialId: string;
  moduleIds: number[];
  examGroupId?: string | null;
};

function sameSection(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return (a || null) === (b || null);
}

export function resolveNextLecture(input: {
  materialId: string;
  moduleIds: number[];
  activeModuleId: number;
  sidebar: NextLectureSidebarMaterial[];
}): NextLectureResult {
  const { materialId, moduleIds, activeModuleId, sidebar } = input;
  const moduleIx = moduleIds.indexOf(activeModuleId);
  const nextModuleId = moduleIx >= 0 ? moduleIds[moduleIx + 1] : undefined;
  if (typeof nextModuleId === "number") {
    return { kind: "lecture", target: { materialId, moduleId: nextModuleId } };
  }

  const currentIdx = sidebar.findIndex((o) => o.materialId === materialId);
  const current = currentIdx >= 0 ? sidebar[currentIdx] : undefined;
  const later =
    currentIdx >= 0
      ? sidebar.slice(currentIdx + 1).filter((o) => o.moduleIds.length > 0)
      : [];

  if (later.length === 0) return { kind: "course_done" };

  const nextInSection = later.find((o) =>
    sameSection(current?.examGroupId, o.examGroupId)
  );
  const firstModuleId = nextInSection?.moduleIds[0];
  if (nextInSection && typeof firstModuleId === "number") {
    return {
      kind: "lecture",
      target: { materialId: nextInSection.materialId, moduleId: firstModuleId },
    };
  }

  return { kind: "section_done" };
}
