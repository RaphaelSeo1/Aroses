import type { CoursePayload } from "@/types/course";

export type MaterialProgress = {
  materialId: string;
  fileName: string;
  modulesTotal: number;
  modulesCompleted: number;
};

export type CourseLearningSummary = {
  courseId: string;
  title: string;
  description: string | null;
  modulesTotal: number;
  modulesCompleted: number;
  uploadsCount: number;
  quizAttempts: number;
  quizCorrect: number;
  quizAccuracyPct: number | null;
  materials: MaterialProgress[];
  /** Links use `/explore/...` instead of dashboard workspace. */
  isExploreLearner?: boolean;
};

export type GlobalLearningTotals = {
  modulesCompleted: number;
  modulesTotal: number;
  quizAttempts: number;
  quizCorrect: number;
  quizAccuracyPct: number | null;
  coursesStarted: number;
  uploadsTotal: number;
};

export function payloadModuleCount(payload: unknown): number {
  const pl = payload as CoursePayload | null;
  return Array.isArray(pl?.modules) ? pl.modules.length : 0;
}

/** Only count completions that still exist in the material's current payload. */
export function validModuleCompletionCount(
  payload: unknown,
  completedModuleIds: Set<number> | undefined
): number {
  const pl = payload as CoursePayload | null;
  if (!Array.isArray(pl?.modules) || pl.modules.length === 0 || !completedModuleIds) {
    return 0;
  }
  const validIds = new Set(pl.modules.map((m) => m.id));
  let count = 0;
  for (const id of completedModuleIds) {
    if (validIds.has(id)) count++;
  }
  return count;
}

/** Bucket attempts into `days` slots: index 0 = oldest day, index days-1 = today. */
export function bucketAttemptsLastDays(
  answeredAtIso: string[],
  days: number
): number[] {
  const buckets = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const iso of answeredAtIso) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - d.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    if (diffDays >= 0 && diffDays < days) {
      const idx = days - 1 - diffDays;
      buckets[idx]++;
    }
  }
  return buckets;
}

export function buildCourseSummaries(args: {
  courses: { id: string; title: string; description: string | null }[];
  materials: {
    id: string;
    course_id: string;
    file_name: string;
    course_payload: unknown;
  }[];
  completions: { material_id: string; module_id: number }[];
  attempts: { material_id: string; is_correct: boolean }[];
}): { courses: CourseLearningSummary[]; global: GlobalLearningTotals } {
  const matByCourse = new Map<string, typeof args.materials>();
  for (const m of args.materials) {
    const arr = matByCourse.get(m.course_id) ?? [];
    arr.push(m);
    matByCourse.set(m.course_id, arr);
  }

  const completedByMaterial = new Map<string, Set<number>>();
  for (const c of args.completions) {
    const set = completedByMaterial.get(c.material_id) ?? new Set<number>();
    set.add(c.module_id);
    completedByMaterial.set(c.material_id, set);
  }

  const attemptsByMaterial = new Map<string, typeof args.attempts>();
  for (const a of args.attempts) {
    const arr = attemptsByMaterial.get(a.material_id) ?? [];
    arr.push(a);
    attemptsByMaterial.set(a.material_id, arr);
  }

  const summaries: CourseLearningSummary[] = [];

  let gModulesTotal = 0;
  let gModulesDone = 0;
  let gAttempts = 0;
  let gCorrect = 0;
  let gUploads = 0;

  for (const course of args.courses) {
    const mats = matByCourse.get(course.id) ?? [];
    let modulesTotal = 0;
    let modulesCompleted = 0;
    let quizAttempts = 0;
    let quizCorrect = 0;
    const materialsOut: MaterialProgress[] = [];

    const activeMats = mats.filter((m) => payloadModuleCount(m.course_payload) > 0);

    for (const m of activeMats) {
      const nMod = payloadModuleCount(m.course_payload);
      modulesTotal += nMod;
      const doneSet = completedByMaterial.get(m.id);
      const doneCount = validModuleCompletionCount(m.course_payload, doneSet);
      modulesCompleted += doneCount;
      gUploads++;

      const attList = attemptsByMaterial.get(m.id) ?? [];
      for (const a of attList) {
        quizAttempts++;
        if (a.is_correct) quizCorrect++;
      }

      materialsOut.push({
        materialId: m.id,
        fileName: m.file_name,
        modulesTotal: nMod,
        modulesCompleted: doneCount,
      });
    }

    gModulesTotal += modulesTotal;
    gModulesDone += modulesCompleted;
    gAttempts += quizAttempts;
    gCorrect += quizCorrect;

    summaries.push({
      courseId: course.id,
      title: course.title,
      description: course.description,
      modulesTotal,
      modulesCompleted,
      uploadsCount: activeMats.length,
      quizAttempts,
      quizCorrect,
      quizAccuracyPct:
        quizAttempts > 0
          ? Math.round((quizCorrect / quizAttempts) * 100)
          : null,
      materials: materialsOut,
    });
  }

  return {
    courses: summaries,
    global: {
      modulesCompleted: gModulesDone,
      modulesTotal: gModulesTotal,
      quizAttempts: gAttempts,
      quizCorrect: gCorrect,
      quizAccuracyPct:
        gAttempts > 0 ? Math.round((gCorrect / gAttempts) * 100) : null,
      coursesStarted: args.courses.length,
      uploadsTotal: gUploads,
    },
  };
}

/** Single-course slice — same rules as profile Progress (`CourseLearningCard`). */
export function summarizeCourseProgress(args: {
  course: { id: string; title: string; description: string | null };
  materials: {
    id: string;
    course_id: string;
    file_name: string;
    course_payload: unknown;
  }[];
  completions: { material_id: string; module_id: number }[];
  attempts: { material_id: string; is_correct: boolean }[];
}): CourseLearningSummary {
  const mats = args.materials.filter((m) => m.course_id === args.course.id);
  const { courses } = buildCourseSummaries({
    courses: [args.course],
    materials: mats,
    completions: args.completions,
    attempts: args.attempts,
  });
  const s = courses[0];
  if (s) return s;
  return {
    courseId: args.course.id,
    title: args.course.title,
    description: args.course.description,
    modulesTotal: 0,
    modulesCompleted: 0,
    uploadsCount: mats.length,
    quizAttempts: 0,
    quizCorrect: 0,
    quizAccuracyPct: null,
    materials: [],
  };
}
