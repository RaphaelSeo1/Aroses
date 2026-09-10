import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeQuizItemsLoose } from "@/lib/ai/course-payload";
import { isMissingDbColumnError } from "@/lib/supabase/schema-compat";
import type { CourseModule, CoursePayload } from "@/types/course";
import {
  mergeFocusQuestionsIntoModuleQuizzes,
  planFocusQuestionImport,
  type FocusQuestionMapping,
  type NoteFocusQuestion,
} from "./map-focus-questions-to-modules";

export type NoteFocusImportPlan = {
  mappings: FocusQuestionMapping[];
  modules: CourseModule[];
  questions: NoteFocusQuestion[];
};

type LinkedNoteRow = {
  id: string;
  contentJson: unknown;
};

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function loadNotesByJob(
  supabase: SupabaseClient,
  jobId: string,
  userId: string
): Promise<LinkedNoteRow[]> {
  const rows: LinkedNoteRow[] = [];
  let notes: Array<Record<string, unknown>> | null = null;
  const first = await supabase
    .from("user_notes")
    .select("id, content_json, deleted_at, user_id")
    .eq("ingest_job_id", jobId)
    .eq("user_id", userId)
    .limit(8);
  let error = first.error;
  notes = (first.data as Array<Record<string, unknown>> | null) ?? null;
  if (error && isMissingDbColumnError(error, "deleted_at")) {
    const retry = await supabase
      .from("user_notes")
      .select("id, content_json, user_id")
      .eq("ingest_job_id", jobId)
      .eq("user_id", userId)
      .limit(8);
    error = retry.error;
    notes = (retry.data as Array<Record<string, unknown>> | null) ?? null;
  }
  if (error && isMissingDbColumnError(error, "ingest_job_id", "course_id")) {
    return rows;
  }
  for (const note of notes ?? []) {
    if (note.deleted_at) continue;
    const id = asId(note.id);
    if (!id) continue;
    rows.push({ id, contentJson: note.content_json ?? null });
  }

  const { data: sessions, error: sessionErr } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_note_id, notes_json, user_id")
    .eq("ingest_job_id", jobId)
    .eq("user_id", userId)
    .limit(8);
  if (sessionErr && isMissingDbColumnError(sessionErr, "user_note_id")) {
    return rows;
  }
  for (const session of sessions ?? []) {
    const noteId = asId((session as { user_note_id?: unknown }).user_note_id);
    if (!noteId) continue;
    const existing = rows.find((r) => r.id === noteId);
    if (!existing) {
      rows.push({ id: noteId, contentJson: session.notes_json ?? null });
    } else if (existing.contentJson == null) {
      existing.contentJson = session.notes_json ?? null;
    }
  }
  return rows;
}

async function loadNotesByMaterial(
  supabase: SupabaseClient,
  materialId: string,
  userId: string
): Promise<LinkedNoteRow[]> {
  const { data: jobs, error } = await supabase
    .from("pdf_ingest_jobs")
    .select("id")
    .eq("material_id", materialId)
    .eq("user_id", userId)
    .limit(12);
  if (error) return [];
  const out: LinkedNoteRow[] = [];
  const seen = new Set<string>();
  for (const job of jobs ?? []) {
    const jobId = asId(job.id);
    if (!jobId) continue;
    for (const row of await loadNotesByJob(supabase, jobId, userId)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

async function loadFocusQuestionsForNotes(
  supabase: SupabaseClient,
  userId: string,
  noteIds: string[],
  materialId: string | null,
  onlyUnattached = false
): Promise<NoteFocusQuestion[]> {
  if (noteIds.length === 0) return [];
  const { data, error } = await supabase
    .from("user_personal_quiz_items")
    .select("id, item, source_excerpt, material_id, module_id")
    .eq("user_id", userId)
    .in("source_note_id", noteIds)
    .limit(400);
  if (error && isMissingDbColumnError(error, "source_note_id", "source_excerpt")) {
    return [];
  }
  if (error) {
    console.error("[note-focus-import] load items", error);
    return [];
  }

  const questions: NoteFocusQuestion[] = [];
  for (const row of data ?? []) {
    const id = asId(row.id);
    if (!id) continue;
    const existingMaterial =
      typeof row.material_id === "string" ? row.material_id : null;
    if (onlyUnattached && existingMaterial) continue;
    if (existingMaterial && existingMaterial !== materialId) continue;
    const parsed = normalizeQuizItemsLoose(
      row.item != null ? [row.item] : []
    );
    const item = parsed[0];
    if (!item) continue;
    questions.push({
      id,
      item,
      sourceExcerpt:
        typeof row.source_excerpt === "string" ? row.source_excerpt : null,
    });
  }
  return questions;
}

function pickContentJson(notes: LinkedNoteRow[]): unknown {
  for (const note of notes) {
    if (note.contentJson && typeof note.contentJson === "object") {
      return note.contentJson;
    }
  }
  return null;
}

function planFromNotes(
  notes: LinkedNoteRow[],
  questions: NoteFocusQuestion[],
  modules: CourseModule[]
): NoteFocusImportPlan {
  if (questions.length === 0) {
    return { mappings: [], modules, questions: [] };
  }
  const planned = planFocusQuestionImport({
    questions,
    modules,
    contentJson: pickContentJson(notes),
  });
  return { ...planned, questions };
}

export async function planNoteFocusQuestionsForJob(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    jobId: string;
    modules: CourseModule[];
    materialId?: string | null;
    onlyUnattached?: boolean;
  }
): Promise<NoteFocusImportPlan | null> {
  const notes = await loadNotesByJob(supabase, opts.jobId, opts.userId);
  if (notes.length === 0) return null;
  const questions = await loadFocusQuestionsForNotes(
    supabase,
    opts.userId,
    notes.map((n) => n.id),
    opts.materialId ?? null,
    opts.onlyUnattached
  );
  return planFromNotes(notes, questions, opts.modules);
}

export async function persistNoteFocusQuestionLinks(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    materialId: string;
    mappings: FocusQuestionMapping[];
  }
): Promise<number> {
  if (opts.mappings.length === 0) return 0;
  const byModule = new Map<number, string[]>();
  for (const mapping of opts.mappings) {
    const list = byModule.get(mapping.moduleId) ?? [];
    list.push(mapping.itemId);
    byModule.set(mapping.moduleId, list);
  }
  let attached = 0;
  for (const [moduleId, ids] of byModule) {
    const { data, error } = await supabase
      .from("user_personal_quiz_items")
      .update({
        material_id: opts.materialId,
        module_id: moduleId,
      })
      .eq("user_id", opts.userId)
      .in("id", ids)
      .select("id");
    if (error) {
      console.error("[note-focus-import] attach", moduleId, error);
      continue;
    }
    attached += data?.length ?? 0;
  }
  return attached;
}

export async function attachNoteFocusQuestionsToMaterial(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    materialId: string;
    modules: CourseModule[];
    jobId?: string | null;
    mergeIntoQuiz?: boolean;
    onlyUnattached?: boolean;
  }
): Promise<{
  attached: number;
  payloadModules: CourseModule[];
  mappings: FocusQuestionMapping[];
}> {
  let plan: NoteFocusImportPlan | null = null;
  if (opts.jobId) {
    plan = await planNoteFocusQuestionsForJob(supabase, {
      userId: opts.userId,
      jobId: opts.jobId,
      modules: opts.modules,
      materialId: opts.materialId,
      onlyUnattached: opts.onlyUnattached,
    });
  } else {
    const notes = await loadNotesByMaterial(
      supabase,
      opts.materialId,
      opts.userId
    );
    if (notes.length === 0) {
      return { attached: 0, payloadModules: opts.modules, mappings: [] };
    }
    const questions = await loadFocusQuestionsForNotes(
      supabase,
      opts.userId,
      notes.map((n) => n.id),
      opts.materialId,
      opts.onlyUnattached
    );
    plan = planFromNotes(notes, questions, opts.modules);
  }

  if (!plan || plan.mappings.length === 0) {
    return { attached: 0, payloadModules: opts.modules, mappings: [] };
  }

  const attached = await persistNoteFocusQuestionLinks(supabase, {
    userId: opts.userId,
    materialId: opts.materialId,
    mappings: plan.mappings,
  });

  return {
    attached,
    payloadModules: opts.mergeIntoQuiz ? plan.modules : opts.modules,
    mappings: plan.mappings,
  };
}

function payloadFromRow(raw: unknown): CoursePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const modules = (raw as CoursePayload).modules;
  if (!Array.isArray(modules)) return null;
  return raw as CoursePayload;
}

/** Relink notes-only focus cards onto an already-built material (existing courses). */
export async function relinkNoteFocusQuestionsForExistingMaterial(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    materialId: string;
    jobId?: string | null;
    mergeIntoQuiz?: boolean;
  }
): Promise<void> {
  const { count, error: countErr } = await supabase
    .from("user_personal_quiz_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .is("material_id", null);
  if (countErr || !count) return;

  const { data: mat, error } = await supabase
    .from("study_materials")
    .select("id, course_payload, canonical_payload")
    .eq("id", opts.materialId)
    .maybeSingle();
  if (error || !mat) return;
  const payload = payloadFromRow(mat.course_payload);
  if (!payload) return;

  const result = await attachNoteFocusQuestionsToMaterial(supabase, {
    userId: opts.userId,
    materialId: opts.materialId,
    modules: payload.modules,
    jobId: opts.jobId,
    mergeIntoQuiz: opts.mergeIntoQuiz,
    onlyUnattached: true,
  });
  if (!opts.mergeIntoQuiz || result.payloadModules === payload.modules) return;

  const patch: Record<string, unknown> = {
    course_payload: { ...payload, modules: result.payloadModules },
  };
  const canonical = payloadFromRow(mat.canonical_payload);
  if (canonical) {
    patch.canonical_payload = payloadWithImportedFocusQuestions(
      canonical,
      result.mappings
    );
  }
  const { error: patchErr } = await supabase
    .from("study_materials")
    .update(patch)
    .eq("id", opts.materialId);
  if (
    patchErr &&
    patch.canonical_payload &&
    isMissingDbColumnError(patchErr, "canonical_payload")
  ) {
    delete patch.canonical_payload;
    await supabase
      .from("study_materials")
      .update(patch)
      .eq("id", opts.materialId);
  }
}

export function payloadWithImportedFocusQuestions(
  payload: CoursePayload,
  mappings: FocusQuestionMapping[]
): CoursePayload {
  return {
    ...payload,
    modules: mergeFocusQuestionsIntoModuleQuizzes(payload.modules, mappings),
  };
}
