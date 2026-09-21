import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";
import { isReviewQuestionEnabled } from "@/lib/srs/question-mutation";
import { hydrateNotesFocusBucketMeta } from "@/lib/notes/hydrate-notes-focus-buckets";
import { repairOrphanNotesFocusCards } from "@/lib/notes/repair-orphan-focus-cards";
import {
  isNotesFocusBucketId,
  notesFocusBucketId,
} from "@/lib/notes/notes-focus-bucket";
import type { SrsDueByMaterial } from "@/lib/srs-due";
import {
  addPersonalFocusCount,
  finalizeFocusBuckets,
} from "@/lib/srs-focus-buckets";
import { queryActiveStudyMaterials } from "@/lib/study-materials/soft-delete";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";

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
    for (let i = 0; i < quiz.length; i++) {
      if (isReviewQuestionEnabled(quiz[i])) out.add(mod.id * 1000 + i);
    }
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

  const { data: matsRaw } = await queryActiveStudyMaterials(
    () =>
      supabase
        .from("study_materials")
        .select(
          "id, file_name, course_id, course_payload, courses ( id, title )"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null),
    () =>
      supabase
        .from("study_materials")
        .select(
          "id, file_name, course_id, course_payload, courses ( id, title )"
        )
        .eq("user_id", user.id)
  );

  const materialById = new Map<string, MaterialRow>();
  for (const raw of matsRaw ?? []) {
    const m = raw as unknown as MaterialRow;
    materialById.set(m.id.toLowerCase(), m);
  }

  // Focus-card counts (may include non-owned materials). Nested by source
  // note even when the card is attached to a course material_id.
  try {
    await repairOrphanNotesFocusCards(supabase, user.id);
  } catch (e) {
    console.error("[practice-scope repair focus]", e);
  }
  type PersonalRow = {
    material_id?: string | null;
    source_note_id?: string | null;
    source_label?: string | null;
  };
  const buildPersonal = (select: string, filterDeleted: boolean) => {
    let q = supabase
      .from("user_personal_quiz_items")
      .select(select)
      .eq("user_id", user.id);
    if (filterDeleted) q = q.is("deleted_at", null);
    return q;
  };
  let firstPersonal = await buildPersonal(
    "material_id, source_note_id, source_label",
    true
  );
  if (
    firstPersonal.error &&
    isMissingDbColumnError(firstPersonal.error, "deleted_at")
  ) {
    firstPersonal = await buildPersonal(
      "material_id, source_note_id, source_label",
      false
    );
  }
  let personalRows: PersonalRow[] | null = firstPersonal.data as PersonalRow[] | null;
  let personalErr = firstPersonal.error;
  if (
    personalErr &&
    isMissingDbColumnError(personalErr, "source_label", "source_note_id")
  ) {
    let fallback = await buildPersonal("material_id", true);
    if (
      fallback.error &&
      isMissingDbColumnError(fallback.error, "deleted_at")
    ) {
      fallback = await buildPersonal("material_id", false);
    }
    personalErr = fallback.error;
    personalRows = (fallback.data ?? []).map((row) => ({
      material_id: (row as { material_id?: string | null }).material_id ?? null,
      source_note_id: null,
      source_label: null,
    }));
  }
  if (personalErr) {
    console.error("[practice-scope personal]", personalErr);
    personalRows = [];
  }

  const missingPersonalMats = new Set<string>();
  const notesBucketIds = new Set<string>();
  for (const row of personalRows ?? []) {
    notesBucketIds.add(
      notesFocusBucketId(
        typeof row.source_note_id === "string" ? row.source_note_id : null
      )
    );
    if (!row.material_id) continue;
    const id = (row.material_id as string).toLowerCase();
    if (!isNotesFocusBucketId(id) && !materialById.has(id)) {
      missingPersonalMats.add(id);
    }
  }
  if (missingPersonalMats.size > 0) {
    const ids = [...missingPersonalMats];
    const { data: extraMats } = await queryActiveStudyMaterials(
      () =>
        supabase
          .from("study_materials")
          .select(
            "id, file_name, course_id, course_payload, courses ( id, title )"
          )
          .in("id", ids)
          .is("deleted_at", null),
      () =>
        supabase
          .from("study_materials")
          .select(
            "id, file_name, course_id, course_payload, courses ( id, title )"
          )
          .in("id", ids)
    );
    for (const raw of extraMats ?? []) {
      const m = raw as unknown as MaterialRow;
      materialById.set(m.id.toLowerCase(), m);
    }
  }

  const notesMeta = await hydrateNotesFocusBucketMeta(
    supabase,
    user.id,
    notesBucketIds
  );

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

  const byMaterial = new Map<string, SrsDueByMaterial>();
  for (const m of materials) {
    const valid = validQuestionIndexes(m.course_payload);
    const attempted = attemptedByMaterial.get(m.id);
    let moduleQuestions = 0;
    if (attempted) {
      for (const qi of attempted) {
        if (valid.has(qi)) moduleQuestions += 1;
      }
    }
    byMaterial.set(m.id.toLowerCase(), {
      materialId: m.id,
      fileName: m.file_name ?? "Untitled upload",
      courseId: deriveCourseId(m),
      courseTitle: deriveCourseTitle(m),
      module: moduleQuestions,
      personal: 0,
      total: moduleQuestions,
    });
  }

  for (const row of personalRows ?? []) {
    addPersonalFocusCount(
      byMaterial,
      {
        materialId: row.material_id ?? null,
        sourceNoteId:
          typeof row.source_note_id === "string" ? row.source_note_id : null,
        sourceLabel:
          typeof row.source_label === "string" ? row.source_label : null,
      },
      notesMeta
    );
  }
  finalizeFocusBuckets(byMaterial);

  const out = [...byMaterial.values()]
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((m) => ({
      materialId: m.materialId,
      fileName: m.fileName,
      courseId: m.courseId,
      courseTitle: m.courseTitle,
      moduleQuestions: m.module,
      personalQuestions: m.personal,
      total: m.total,
      notes: m.notes,
      sectionId: m.sectionId,
      sectionTitle: m.sectionTitle,
      hubKind: m.hubKind,
    }));

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
