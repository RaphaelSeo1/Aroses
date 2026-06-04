import type { CoursePayload } from "@/types/course";
import { parseCoursePayload } from "@/lib/ai/course-payload";

export type AggregatedCourseContent = {
  lessonCount: number;
  moduleCount: number;
  quizCount: number;
  avgLessonChars: number;
  sampleText: string;
  materialCount: number;
};

export function aggregateCourseMaterials(
  materials: { course_payload: unknown }[]
): AggregatedCourseContent {
  let lessonCount = 0;
  let moduleCount = 0;
  let quizCount = 0;
  let totalChars = 0;
  const textParts: string[] = [];

  for (const row of materials) {
    try {
      const payload = parseCoursePayload(row.course_payload);
      moduleCount += payload.modules.length;
      for (const mod of payload.modules) {
        quizCount += mod.quiz.length;
        for (const lesson of mod.lessons) {
          lessonCount += 1;
          const body = lesson.content?.trim() ?? "";
          totalChars += body.length;
          if (body.length > 80 && textParts.length < 8) {
            textParts.push(
              `## ${lesson.title}\n${body.slice(0, 1200)}`
            );
          }
        }
      }
    } catch {
      // skip malformed material
    }
  }

  const avgLessonChars =
    lessonCount > 0 ? Math.round(totalChars / lessonCount) : 0;

  return {
    lessonCount,
    moduleCount,
    quizCount,
    avgLessonChars,
    sampleText: textParts.join("\n\n").slice(0, 8_000),
    materialCount: materials.length,
  };
}
