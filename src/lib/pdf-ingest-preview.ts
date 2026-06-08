import {
  parseCourseModule,
  parseCourseOutlinePayload,
  stripJsonFence,
  type CourseOutlinePayload,
} from "@/lib/ai/course-payload";
import type { CourseLesson, CourseModule, CoursePayload } from "@/types/course";

/**
 * Best-effort: the DB stores a **tail** of the streaming outline JSON. Try longer
 * prefixes first so the UI can show a live course shell as soon as the stream
 * contains a complete parseable outline object.
 */
export function tryOutlinePreviewFromStreamTail(
  stream: string
): CoursePayload | null {
  const s = stream.trim();
  if (s.length < 200) return null;
  const cleaned = stripJsonFence(s);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  const frag = cleaned.slice(start);
  const maxLen = Math.min(frag.length, 28_000);
  for (let len = maxLen; len > 120; len -= 60) {
    try {
      const parsed: unknown = JSON.parse(frag.slice(0, len));
      return buildLivePreviewCourse(parsed, []);
    } catch {
      /* try shorter prefix — incomplete trailing `}` etc. */
    }
  }
  return null;
}

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
      if (raw == null) continue;
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
