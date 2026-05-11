import {
  parseCourseModule,
  parseCourseOutlinePayload,
  type CourseOutlinePayload,
} from "@/lib/ai/course-payload";
import type { CourseLesson, CourseModule, CoursePayload } from "@/types/course";

/**
 * Merge stored outline + any completed modules into a `CoursePayload` the study UI can render
 * while the job is still running (placeholders for lessons not yet expanded).
 */
export function buildLivePreviewCourse(
  outlineJson: unknown,
  modulesJson: unknown
): CoursePayload | null {
  if (!outlineJson || typeof outlineJson !== "object") return null;
  let outline: CourseOutlinePayload;
  try {
    outline = parseCourseOutlinePayload(outlineJson);
  } catch {
    return null;
  }

  let built: CourseModule[] = [];
  if (Array.isArray(modulesJson)) {
    for (const raw of modulesJson) {
      try {
        built.push(parseCourseModule(raw));
      } catch {
        /* skip corrupt slot */
      }
    }
  }

  const byId = new Map(built.map((m) => [m.id, m]));

  const modules: CourseModule[] = outline.modules.map((stub) => {
    const real = byId.get(stub.id);
    if (real) return real;
    const lessons: CourseLesson[] = stub.lesson_titles.map((title) => ({
      title,
      content: "",
      key_terms: [],
      examples: [],
    }));
    return {
      id: stub.id,
      title: stub.title,
      lessons,
      quiz: [],
    };
  });

  return {
    title: outline.title,
    description: outline.description,
    modules,
  };
}
