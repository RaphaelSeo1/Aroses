import type { CoursePayload } from "@/types/course";

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Best-effort: find the first module that mentions `query` in its title,
 * lesson titles, lesson content, or key terms.
 */
export function findBestModuleIdForQuery(
  payload: CoursePayload,
  queryRaw: string
): { moduleId: number; reason: string } | null {
  const q = norm(queryRaw);
  if (!q) return null;

  // 1) Title matches first.
  for (const mod of payload.modules) {
    if (norm(mod.title).includes(q)) {
      return { moduleId: mod.id, reason: `Found in module title: “${mod.title}”.` };
    }
    for (const lesson of mod.lessons) {
      if (norm(lesson.title).includes(q)) {
        return {
          moduleId: mod.id,
          reason: `Found in lesson title: “${lesson.title}”.`,
        };
      }
    }
  }

  // 2) Key terms / content.
  for (const mod of payload.modules) {
    for (const lesson of mod.lessons) {
      for (const kt of lesson.key_terms ?? []) {
        if (norm(kt.term).includes(q) || norm(kt.definition).includes(q)) {
          return {
            moduleId: mod.id,
            reason: `Found in key term “${kt.term}”.`,
          };
        }
      }
      if (norm(lesson.content ?? "").includes(q)) {
        return {
          moduleId: mod.id,
          reason: `Found in lesson content for “${lesson.title}”.`,
        };
      }
    }
  }

  return null;
}

export function findBestStudyLocationForQuery(args: {
  materials: { id: string; course_payload: CoursePayload }[];
  query: string;
}): { materialId: string; moduleId: number; reason: string } | null {
  for (const m of args.materials) {
    const hit = findBestModuleIdForQuery(m.course_payload, args.query);
    if (hit) {
      return { materialId: m.id, moduleId: hit.moduleId, reason: hit.reason };
    }
  }
  return null;
}

