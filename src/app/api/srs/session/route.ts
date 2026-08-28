import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload, CourseQuizItem } from "@/types/course";
import type { SrsRating } from "@/lib/srs-sm2";
import {
  isNotesFocusBucketId,
  NOTES_FOCUS_BUCKET_ID,
} from "@/lib/notes/notes-focus-bucket";

/**
 * GET /api/srs/session
 *
 * Builds a mixed deck of due + new cards for a review session.
 *
 * Query params (all optional unless noted):
 *   scope=both|module|personal   (default "both")
 *   materialId=<uuid>            limit to one course/material
 *   materialIds=<csv-of-uuid>    limit to a subset of courses
 *   moduleId=<int>               limit to one module (requires materialId)
 *   newLimit=<int>               override per-day new-card cap
 *   maxReviews=<int>             override per-day review cap
 *
 * Response:
 *   {
 *     cards: SessionCard[],
 *     totals: { due, new, total },
 *     limits: { newCardsPerDay, maxReviewsPerDay },
 *     scopes: { materials: [{ id, fileName, courseId, courseTitle }] }
 *   }
 *
 * Cards are returned in play order. "Again" same-session re-show is handled
 * client-side by SrsReviewSession.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scope = "both" | "module" | "personal";

export type SessionCard =
  | {
      kind: "module";
      cardKey: string; // stable id for client list keys
      materialId: string;
      fileName: string;
      courseId: string | null;
      courseTitle: string | null;
      moduleId: number;
      moduleTitle: string;
      questionIndex: number;
      quizIndex: number; // within the module
      question: CourseQuizItem;
      srs: { ease: number; intervalDays: number; reps: number } | null;
      dueAt: string | null;
      isNew: boolean;
      reviewCount: number;
    }
  | {
      kind: "personal";
      cardKey: string;
      personalItemId: string;
      materialId: string;
      fileName: string;
      courseId: string | null;
      courseTitle: string | null;
      moduleId: number;
      moduleTitle: string;
      question: CourseQuizItem;
      srs: { ease: number; intervalDays: number; reps: number } | null;
      dueAt: string;
      isNew: boolean;
      reviewCount: number;
    };

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const scope = parseScope(url.searchParams.get("scope")) ?? "both";
  // Cram / "Practice all": ignore the spaced-repetition schedule and serve
  // every card in scope. Without this, a finished deck schedules its cards
  // into the future, so a re-run (or revisiting saved focus cards) returns an
  // empty session — which looked like "my stored questions don't come up".
  const cram = url.searchParams.get("cram") === "1";
  const materialIdParam = url.searchParams.get("materialId") ?? "";
  const materialIdsParam = url.searchParams.get("materialIds") ?? "";
  const moduleIdParam = url.searchParams.get("moduleId");

  const allowedMaterialIds = collectMaterialIds(materialIdParam, materialIdsParam);

  // -------- Load prefs ----------------------------------------------------
  const prefs = await loadPrefs(supabase, user.id);

  const newLimit = clampInt(
    url.searchParams.get("newLimit"),
    prefs.newCardsPerDay,
    0,
    500
  );
  const maxReviews = clampInt(
    url.searchParams.get("maxReviews"),
    prefs.maxReviewsPerDay,
    1,
    2000
  );

  const moduleIdFilter =
    moduleIdParam != null && Number.isFinite(Number(moduleIdParam))
      ? Number(moduleIdParam)
      : null;

  const nowIso = new Date().toISOString();

  // -------- Module-bank source -------------------------------------------
  const moduleDue: SessionCard[] = [];
  const moduleNew: SessionCard[] = [];

  // Owned materials power the global module bank. Focus/personal cards may
  // also live on materials the user can access but does not own (Explore,
  // shared, course-owner ≠ material.user_id) — those are loaded below by id.
  const { data: ownedMaterials } = await supabase
    .from("study_materials")
    .select(
      "id, course_id, file_name, course_payload, courses ( id, title )"
    )
    .eq("user_id", user.id);

  const materials = (ownedMaterials ?? [])
    .map((m) => m as unknown as MaterialRow)
    .filter((m) => {
      if (allowedMaterialIds && !allowedMaterialIds.has(normId(m.id))) {
        return false;
      }
      return true;
    });

  const materialById = new Map<string, MaterialRow>();
  for (const m of materials) materialById.set(normId(m.id), m);

  // -- Due module cards (existing SRS state, due_at <= now)
  if (scope !== "personal") {
    let dueQuery = supabase
      .from("user_module_card_srs")
      .select(
        "material_id, question_index, srs_ease, srs_interval_days, srs_reps, due_at, review_history"
      )
      .eq("user_id", user.id)
      .order("due_at", { ascending: true })
      .limit(cram ? 5000 : Math.max(1, maxReviews));
    // In cram mode we want every card that has SRS state regardless of when
    // it's next due.
    if (!cram) {
      dueQuery = dueQuery.lte("due_at", nowIso);
    }

    if (allowedMaterialIds && allowedMaterialIds.size > 0) {
      dueQuery = dueQuery.in("material_id", [...allowedMaterialIds]);
    }

    const { data: dueRows } = await dueQuery;
    for (const row of dueRows ?? []) {
      const mat = materialById.get(normId(row.material_id as string));
      if (!mat) continue;
      const { moduleId, quizIndex } = decodeQuestionIndex(
        row.question_index as number
      );
      if (moduleIdFilter != null && moduleIdFilter !== moduleId) continue;
      const question = pluckQuestion(mat.course_payload, moduleId, quizIndex);
      if (!question) continue;
      moduleDue.push(buildModuleCard(mat, moduleId, quizIndex, question, row, false));
    }

    // -- New module cards (no SRS row yet)
    const seenKeys = await loadSeenModuleKeys(supabase, user.id, allowedMaterialIds);
    // Free practice (cram) should only resurface questions the learner has
    // actually tried before — not brand-new questions from courses they
    // haven't studied yet. "Tried" = answered in a quiz (question_attempts).
    // SRS-reviewed cards already show up via `moduleDue` above. In scheduled
    // review (non-cram) we still introduce genuinely new cards, since that's
    // how the learner makes progress.
    const attemptedKeys = cram
      ? await loadAttemptedModuleKeys(supabase, user.id, allowedMaterialIds)
      : null;
    const newCandidates: SessionCard[] = [];
    for (const mat of materials) {
      const modules = mat.course_payload?.modules ?? [];
      for (const mod of modules) {
        if (moduleIdFilter != null && mod.id !== moduleIdFilter) continue;
        const quiz = Array.isArray(mod.quiz) ? mod.quiz : [];
        for (let i = 0; i < quiz.length; i++) {
          const qi = mod.id * 1000 + i;
          if (seenKeys.has(`${mat.id}:${qi}`)) continue;
          // Cram: skip questions the learner has never attempted.
          if (attemptedKeys && !attemptedKeys.has(`${mat.id}:${qi}`)) continue;
          const question = quiz[i];
          if (!question) continue;
          newCandidates.push(
            buildModuleCard(mat, mod.id, i, question, null, true)
          );
        }
      }
    }
    // Shuffle new candidates a little so multiple courses interleave.
    shuffleInPlace(newCandidates);
    moduleNew.push(...newCandidates.slice(0, cram ? newCandidates.length : newLimit));
  }

  // -------- Personal source ---------------------------------------------
  const personalDue: SessionCard[] = [];
  const personalNew: SessionCard[] = [];

  if (scope !== "module") {
    const personalSelect =
      "id, material_id, module_id, item, srs_ease, srs_interval_days, srs_reps, due_at, last_reviewed_at, review_history, source_label";

    const uuids =
      allowedMaterialIds && allowedMaterialIds.size > 0
        ? [...allowedMaterialIds].filter((id) => UUID_RE.test(id))
        : null;
    const includeNotes =
      !allowedMaterialIds ||
      allowedMaterialIds.size === 0 ||
      [...allowedMaterialIds].some((id) => isNotesFocusBucketId(id));

    const personalRows: Record<string, unknown>[] = [];
    if (uuids === null) {
      const { data } = await supabase
        .from("user_personal_quiz_items")
        .select(personalSelect)
        .eq("user_id", user.id)
        .order("due_at", { ascending: true });
      personalRows.push(...((data ?? []) as Record<string, unknown>[]));
    } else {
      if (uuids.length > 0) {
        const { data } = await supabase
          .from("user_personal_quiz_items")
          .select(personalSelect)
          .eq("user_id", user.id)
          .in("material_id", uuids)
          .order("due_at", { ascending: true });
        personalRows.push(...((data ?? []) as Record<string, unknown>[]));
      }
      if (includeNotes) {
        const { data } = await supabase
          .from("user_personal_quiz_items")
          .select(personalSelect)
          .eq("user_id", user.id)
          .is("material_id", null)
          .order("due_at", { ascending: true });
        personalRows.push(...((data ?? []) as Record<string, unknown>[]));
      }
    }

    // Hydrate materials for personal cards that aren't in the owned map
    // (shared / Explore / legacy course-owner rows). Never drop a user's own
    // focus card just because they don't own the underlying study_materials row.
    const missingMaterialIds = new Set<string>();
    for (const row of personalRows ?? []) {
      const mid = row.material_id
        ? normId(row.material_id as string)
        : "";
      if (mid && !isNotesFocusBucketId(mid) && !materialById.has(mid)) {
        missingMaterialIds.add(mid);
      }
    }
    if (missingMaterialIds.size > 0) {
      const { data: extraMats } = await supabase
        .from("study_materials")
        .select(
          "id, course_id, file_name, course_payload, courses ( id, title )"
        )
        .in("id", [...missingMaterialIds]);
      for (const raw of extraMats ?? []) {
        const m = raw as unknown as MaterialRow;
        materialById.set(normId(m.id), m);
      }
    }

    for (const row of personalRows ?? []) {
      const rawMid = row.material_id as string | null;
      const isNotesOnly = !rawMid;
      const mid = isNotesOnly ? NOTES_FOCUS_BUCKET_ID : normId(rawMid);
      const mat = isNotesOnly
        ? stubMaterial(NOTES_FOCUS_BUCKET_ID)
        : materialById.get(mid) ?? stubMaterial(mid);
      const rowModuleId =
        row.module_id == null ? 0 : Number(row.module_id);
      if (moduleIdFilter != null && rowModuleId !== moduleIdFilter) continue;
      const question = row.item as CourseQuizItem;
      if (!question || typeof question !== "object") continue;

      const reps = Number(row.srs_reps) || 0;
      const reviewCount = Array.isArray(row.review_history)
        ? row.review_history.length
        : 0;
      const isNew = reviewCount === 0 && reps === 0 && row.last_reviewed_at == null;

      const dueIso = (row.due_at as string) ?? nowIso;
      const isDue = new Date(dueIso).getTime() <= Date.now();
      const notesLabel =
        typeof row.source_label === "string" && row.source_label.trim()
          ? row.source_label.trim()
          : "Focus questions";

      const card: SessionCard = {
        kind: "personal",
        cardKey: `personal:${row.id}`,
        personalItemId: row.id as string,
        materialId: isNotesOnly ? NOTES_FOCUS_BUCKET_ID : mat.id,
        fileName: isNotesOnly ? notesLabel : (mat.file_name ?? "Untitled upload"),
        courseId: isNotesOnly ? null : deriveCourseId(mat),
        courseTitle: isNotesOnly ? "Notes" : deriveCourseTitle(mat),
        moduleId: rowModuleId,
        moduleTitle: isNotesOnly
          ? notesLabel
          : lookupModuleTitle(mat.course_payload, rowModuleId),
        question,
        srs: {
          ease: Number(row.srs_ease) || 2.5,
          intervalDays: Number(row.srs_interval_days) || 0,
          reps,
        },
        dueAt: dueIso,
        isNew,
        reviewCount,
      };

      if (cram) {
        // Practice-all: every saved card is eligible, no new/due split.
        personalDue.push(card);
      } else if (isNew) {
        personalNew.push(card);
      } else if (isDue) {
        personalDue.push(card);
      }
    }
    // Cap new personal cards by remaining new-card budget. Module new cards
    // already took some of the budget; share it across both sources fairly.
    const personalNewCap = Math.max(0, newLimit - moduleNew.length);
    if (!cram && personalNew.length > personalNewCap) {
      shuffleInPlace(personalNew);
      personalNew.length = personalNewCap;
    }
  }

  // -------- Interleave ---------------------------------------------------
  // Strategy: due cards first (mixed across sources), then new cards mixed.
  // Within each phase, alternate sources so the learner doesn't see 20 of
  // one type in a row.
  const due = interleave(moduleDue, personalDue);
  const fresh = interleave(moduleNew, personalNew);

  // Cap total deck by maxReviews (due never gets capped — those are the
  // ones the user actually owes today). If we still have budget after due,
  // pour new cards in.
  const remaining = cram ? fresh.length : Math.max(0, maxReviews - due.length);
  const cards = [...due, ...fresh.slice(0, remaining)];

  const scopesMaterials = [...materialById.values()].map((m) => ({
    id: m.id,
    fileName: m.file_name ?? "Untitled upload",
    courseId: deriveCourseId(m),
    courseTitle: deriveCourseTitle(m),
  }));

  return NextResponse.json({
    cards,
    totals: {
      due: due.length,
      new: Math.min(fresh.length, remaining),
      total: cards.length,
    },
    limits: {
      newCardsPerDay: newLimit,
      maxReviewsPerDay: maxReviews,
    },
    scopes: { materials: scopesMaterials },
  });
}

// ---------- helpers --------------------------------------------------------

function parseScope(v: string | null): Scope | null {
  if (v === "module" || v === "personal" || v === "both") return v;
  return null;
}

function normId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

function stubMaterial(id: string): MaterialRow {
  return {
    id,
    course_id: null,
    file_name: "Focus cards",
    course_payload: null,
    courses: null,
  };
}

function collectMaterialIds(
  single: string,
  many: string
): Set<string> | null {
  const ids = new Set<string>();
  const candidate = (s: string) => {
    const t = normId(s);
    if (t && (UUID_RE.test(t) || isNotesFocusBucketId(t))) ids.add(t);
  };
  if (single) candidate(single);
  if (many) {
    for (const piece of many.split(",")) candidate(piece);
  }
  return ids.size > 0 ? ids : null;
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null) return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function decodeQuestionIndex(idx: number): {
  moduleId: number;
  quizIndex: number;
} {
  return { moduleId: Math.floor(idx / 1000), quizIndex: idx % 1000 };
}

function pluckQuestion(
  payload: CoursePayload | null,
  moduleId: number,
  quizIndex: number
): CourseQuizItem | null {
  if (!payload) return null;
  const mod = payload.modules?.find((m) => m.id === moduleId);
  if (!mod) return null;
  const q = mod.quiz?.[quizIndex];
  return q ?? null;
}

function lookupModuleTitle(
  payload: CoursePayload | null,
  moduleId: number
): string {
  const t = payload?.modules?.find((m) => m.id === moduleId)?.title;
  return t ?? `Module ${moduleId}`;
}

type MaterialRow = {
  id: string;
  course_id: string | null;
  file_name: string | null;
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
  if (Array.isArray(c)) return c[0]?.id ?? null;
  return c.id ?? null;
}

function deriveCourseTitle(m: MaterialRow): string | null {
  const c = m.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.title ?? null;
  return c.title ?? null;
}

function buildModuleCard(
  mat: MaterialRow,
  moduleId: number,
  quizIndex: number,
  question: CourseQuizItem,
  srsRow:
    | {
        srs_ease?: number | null;
        srs_interval_days?: number | null;
        srs_reps?: number | null;
        due_at?: string | null;
        review_history?: unknown;
      }
    | null,
  isNew: boolean
): SessionCard {
  const questionIndex = moduleId * 1000 + quizIndex;
  const reviewCount = Array.isArray(srsRow?.review_history)
    ? (srsRow!.review_history as unknown[]).length
    : 0;
  return {
    kind: "module",
    cardKey: `module:${mat.id}:${questionIndex}`,
    materialId: mat.id,
    fileName: mat.file_name ?? "Untitled upload",
    courseId: deriveCourseId(mat),
    courseTitle: deriveCourseTitle(mat),
    moduleId,
    moduleTitle: lookupModuleTitle(mat.course_payload, moduleId),
    questionIndex,
    quizIndex,
    question,
    srs: srsRow
      ? {
          ease: Number(srsRow.srs_ease) || 2.5,
          intervalDays: Number(srsRow.srs_interval_days) || 0,
          reps: Number(srsRow.srs_reps) || 0,
        }
      : null,
    dueAt: srsRow?.due_at ?? null,
    isNew,
    reviewCount,
  };
}

async function loadSeenModuleKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  materialFilter: Set<string> | null
): Promise<Set<string>> {
  let q = supabase
    .from("user_module_card_srs")
    .select("material_id, question_index")
    .eq("user_id", userId);
  if (materialFilter && materialFilter.size > 0) {
    q = q.in("material_id", [...materialFilter]);
  }
  const { data } = await q;
  const out = new Set<string>();
  for (const row of data ?? []) {
    out.add(`${row.material_id}:${row.question_index}`);
  }
  return out;
}

/** `${materialId}:${questionIndex}` for every module question the user has
 *  attempted in a quiz — the "tried before" set used to scope free practice. */
async function loadAttemptedModuleKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  materialFilter: Set<string> | null
): Promise<Set<string>> {
  let q = supabase
    .from("question_attempts")
    .select("material_id, question_index")
    .eq("user_id", userId);
  if (materialFilter && materialFilter.size > 0) {
    q = q.in("material_id", [...materialFilter]);
  }
  const { data } = await q;
  const out = new Set<string>();
  for (const row of data ?? []) {
    out.add(`${row.material_id}:${row.question_index}`);
  }
  return out;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Round-robin two lists so we don't show all of one type in a row. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

async function loadPrefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ newCardsPerDay: number; maxReviewsPerDay: number }> {
  const { data } = await supabase
    .from("user_srs_prefs")
    .select("new_cards_per_day, max_reviews_per_day")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    newCardsPerDay: Number(data?.new_cards_per_day) || 20,
    maxReviewsPerDay: Number(data?.max_reviews_per_day) || 100,
  };
}

// History entry shape — kept for future use (mass-stats endpoint).
export type HistoryEntry = { at: string; rating: SrsRating };
