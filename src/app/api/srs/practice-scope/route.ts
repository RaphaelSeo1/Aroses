import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";

/**
 * GET /api/srs/practice-scope
 *
 * Lists every course the user can free-practice on, with the TOTAL number of
 * practiceable questions per course (module-bank quiz questions + saved focus
 * cards) — i.e. the universe a cram/"free practice" session draws from,
 * regardless of the spaced-repetition schedule.
 *
 * Unlike /api/srs/due-counts (which only surfaces courses with cards *due*),
 * this returns all owned courses so the learner can pick what to cram.
 */

type MaterialRow = {
  id: string;
  file_name: string | null;
  course_id: string | null;
  course_payload: CoursePayload | null;
  courses:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null;
};

function deriveCourseId(m: MaterialRow): string | null {
  if (m.course_id) return m.course_id;
  const c = m.courses;
  if (!c) return null;
  return Array.isArray(c) ? (c[0]?.id ?? null) : (c.id ?? null);
}

function deriveCourseTitle(m: MaterialRow): string | null {
  const c = m.courses;
  if (!c) return null;
  return Array.isArray(c) ? (c[0]?.title ?? null) : (c.title ?? null);
}

function countModuleQuestions(payload: CoursePayload | null): number {
  if (!payload?.modules) return 0;
  let n = 0;
  for (const mod of payload.modules) {
    if (Array.isArray(mod.quiz)) n += mod.quiz.length;
  }
  return n;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: matsRaw } = await supabase
    .from("study_materials")
    .select("id, file_name, course_id, course_payload, courses ( id, title )")
    .eq("user_id", user.id);

  const materials = (matsRaw ?? []) as unknown as MaterialRow[];

  // Focus-card counts per material.
  const personalByMaterial = new Map<string, number>();
  const { data: personalRows } = await supabase
    .from("user_personal_quiz_items")
    .select("material_id")
    .eq("user_id", user.id);
  for (const row of personalRows ?? []) {
    const id = row.material_id as string;
    personalByMaterial.set(id, (personalByMaterial.get(id) ?? 0) + 1);
  }

  const out = materials
    .map((m) => {
      const moduleQuestions = countModuleQuestions(m.course_payload);
      const personalQuestions = personalByMaterial.get(m.id) ?? 0;
      return {
        materialId: m.id,
        fileName: m.file_name ?? "Untitled upload",
        courseId: deriveCourseId(m),
        courseTitle: deriveCourseTitle(m),
        moduleQuestions,
        personalQuestions,
        total: moduleQuestions + personalQuestions,
      };
    })
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);

  const totals = out.reduce(
    (acc, m) => {
      acc.module += m.moduleQuestions;
      acc.personal += m.personalQuestions;
      acc.total += m.total;
      return acc;
    },
    { module: 0, personal: 0, total: 0 }
  );

  return NextResponse.json({ materials: out, totals });
}
