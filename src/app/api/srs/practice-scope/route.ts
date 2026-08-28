import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";
import { NOTES_FOCUS_BUCKET_ID } from "@/lib/notes/notes-focus-bucket";

/**
 * GET /api/srs/practice-scope
 *
 * Lists every course the user can free-practice on, with the number of
 * practiceable questions per course. "Practiceable" means questions the
 * learner has actually TRIED before — module questions they've answered in a
 * quiz (`question_attempts`) or reviewed in SRS (`user_module_card_srs`), plus
 * their saved focus cards. Brand-new questions from courses they haven't
 * studied yet are intentionally excluded, so free practice resurfaces things
 * they've seen rather than introducing unfamiliar material.
 *
 * Unlike /api/srs/due-counts (which only surfaces courses with cards *due*),
 * this returns all owned courses with tried questions so the learner can pick
 * what to cram.
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

/** Set of valid `moduleId*1000+quizIndex` for a course (guards against stale
 *  attempt rows pointing at questions that no longer exist). */
function validQuestionIndexes(payload: CoursePayload | null): Set<number> {
  const out = new Set<number>();
  if (!payload?.modules) return out;
  for (const mod of payload.modules) {
    const quiz = Array.isArray(mod.quiz) ? mod.quiz : [];
    for (let i = 0; i < quiz.length; i++) out.add(mod.id * 1000 + i);
  }
  return out;
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

  const materialById = new Map<string, MaterialRow>();
  for (const raw of matsRaw ?? []) {
    const m = raw as unknown as MaterialRow;
    materialById.set(m.id.toLowerCase(), m);
  }

  // Focus-card counts per material (may include non-owned materials).
  const personalByMaterial = new Map<string, number>();
  const { data: personalRows } = await supabase
    .from("user_personal_quiz_items")
    .select("material_id")
    .eq("user_id", user.id);
  for (const row of personalRows ?? []) {
    const id = row.material_id
      ? (row.material_id as string).toLowerCase()
      : NOTES_FOCUS_BUCKET_ID;
    personalByMaterial.set(id, (personalByMaterial.get(id) ?? 0) + 1);
  }

  const missingPersonalMats = [...personalByMaterial.keys()].filter(
    (id) => id !== NOTES_FOCUS_BUCKET_ID && !materialById.has(id)
  );
  if (missingPersonalMats.length > 0) {
    const { data: extraMats } = await supabase
      .from("study_materials")
      .select("id, file_name, course_id, course_payload, courses ( id, title )")
      .in("id", missingPersonalMats);
    for (const raw of extraMats ?? []) {
      const m = raw as unknown as MaterialRow;
      materialById.set(m.id.toLowerCase(), m);
    }
  }

  const materials = [...materialById.values()];

  // "Tried before" module questions: union of quiz attempts and SRS-reviewed
  // cards, keyed by material → set of question_index.
  const attemptedByMaterial = new Map<string, Set<number>>();
  const addAttempt = (materialId: string, questionIndex: number) => {
    let set = attemptedByMaterial.get(materialId);
    if (!set) {
      set = new Set<number>();
      attemptedByMaterial.set(materialId, set);
    }
    set.add(questionIndex);
  };
  const [{ data: attemptRows }, { data: srsRows }] = await Promise.all([
    supabase
      .from("question_attempts")
      .select("material_id, question_index")
      .eq("user_id", user.id),
    supabase
      .from("user_module_card_srs")
      .select("material_id, question_index")
      .eq("user_id", user.id),
  ]);
  for (const row of attemptRows ?? []) {
    addAttempt(row.material_id as string, row.question_index as number);
  }
  for (const row of srsRows ?? []) {
    addAttempt(row.material_id as string, row.question_index as number);
  }

  const out = materials
    .map((m) => {
      // Count only attempted questions that still exist in the course payload.
      const valid = validQuestionIndexes(m.course_payload);
      const attempted = attemptedByMaterial.get(m.id);
      let moduleQuestions = 0;
      if (attempted) {
        for (const qi of attempted) {
          if (valid.has(qi)) moduleQuestions += 1;
        }
      }
      const personalQuestions =
        personalByMaterial.get(m.id.toLowerCase()) ?? 0;
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

  const notesCount = personalByMaterial.get(NOTES_FOCUS_BUCKET_ID) ?? 0;
  if (notesCount > 0) {
    out.push({
      materialId: NOTES_FOCUS_BUCKET_ID,
      fileName: "Focus questions",
      courseId: null,
      courseTitle: "Notes",
      moduleQuestions: 0,
      personalQuestions: notesCount,
      total: notesCount,
    });
  }

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
