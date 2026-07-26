"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { confirmDialog } from "@/components/AppDialogs";
import { CourseModeToggle } from "@/components/CourseModeToggle";
import { LessonEditableBlocks } from "@/components/LessonEditableBlocks";
import { LessonNotesCapture } from "@/components/LessonNotesCapture";
import { ModuleQuizReview } from "@/components/ModuleQuizReview";
import { ModuleQuiz } from "@/components/ModuleQuiz";
import { PersonalQuizSection } from "@/components/PersonalQuizSection";
import { buildQuizSessionItems } from "@/lib/quiz-session";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { useCourseMode } from "@/lib/mentored/use-course-mode";
import { touchCourseProgress } from "@/lib/course-progress/touch-client";
import { persistStudyModulePosition } from "@/lib/study/persist-study-module";
import { CourseRefineDrawer } from "@/components/CourseRefineDrawer";
import { PracticeProgressPullTab } from "@/components/PracticeProgressPullTab";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import { VoiceTutorDock } from "@/components/VoiceTutorDock";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import {
  isWeakModuleTitle,
  moduleTitleFromLessonTitles,
} from "@/lib/study-ingest/normalize-ingest-title";
import {
  AROSES_COURSE_REFINE_APPLY_START_EVENT,
  AROSES_COURSE_REFINE_LESSON_DELTA_EVENT,
  AROSES_COURSE_REFINE_LESSON_EDIT_EVENT,
  AROSES_COURSE_REFINE_PATCH_EVENT,
  AROSES_COURSE_REFINE_PREVIEW_EVENT,
  AROSES_COURSE_REFINED_EVENT,
  type ArosesCourseRefineApplyStartDetail,
  type ArosesCourseRefineLessonDeltaDetail,
  type ArosesCourseRefineLessonEditDetail,
  type ArosesCourseRefinePatchDetail,
  type ArosesCourseRefinePreviewDetail,
  type ArosesCourseRefinePreviewEdit,
  type ArosesCourseRefinedDetail,
} from "@/lib/refine-course-events";
import {
  AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT,
  stopRefineApplyJob,
  type ArosesCourseRefineApplyCancelledDetail,
} from "@/lib/refine-course-client-job";
import type {
  CourseModule,
  CoursePayload,
  CourseQuizItem,
  SidebarMaterialOutline,
} from "@/types/course";
import type { QuizReviewStatsDto } from "@/types/quiz-review";
import type { CourseLearningSummary } from "@/lib/learning-stats";
const EMPTY_MODULE_QUIZ: CourseQuizItem[] = [];

/** Drop a leading section number ("1 Institutional Background" → "Institutional
 * Background", "2. Foo", "1.2 Bar"); 1–2 digits only so years survive. */
function stripLeadingSectionNumber(s: string): string {
  const out = s.replace(/^\s*\d{1,2}(?:\.\d{1,2})*[.):]?\s+(?=\S)/, "").trim();
  return out || s.trim();
}

/**
 * Header/sidebar title for a module. Normally the stored title is already a
 * descriptive, generator-produced label, so we just strip a leading section
 * number for tidiness. When the stored title is still a weak placeholder
 * ("Section 3", "Part 1", a bare acronym) — common in older builds — and the
 * module's lessons are available, derive a descriptive title from the lesson
 * topics so the UI never shows a positional label.
 */
function moduleDisplayTitle(m: {
  title: string;
  lessons?: { title: string }[];
}): string {
  const stripped = stripLeadingSectionNumber(m.title);
  if (m.lessons && m.lessons.length > 0 && isWeakModuleTitle(stripped)) {
    const derived = moduleTitleFromLessonTitles(m.lessons.map((l) => l.title));
    if (derived && !isWeakModuleTitle(derived)) {
      return stripLeadingSectionNumber(derived);
    }
  }
  return stripped;
}

function ModuleLessonJumpNav({
  lessons,
  onJump,
}: {
  lessons: { title: string }[];
  onJump: (lessonIndex: number) => void;
}) {
  const t = useT();
  if (lessons.length <= 1) return null;
  return (
    <div className="mb-2 ml-2 mt-1 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t.study.lessons}
      </p>
      <ul className="space-y-0.5">
        {lessons.map((lesson, li) => (
          <li key={li}>
            <button
              type="button"
              onClick={() => onJump(li)}
              className="w-full rounded-md px-2 py-1 text-left text-[11px] leading-snug text-zinc-600 hover:bg-brand-blush/80 hover:text-brand-ink dark:text-zinc-400 dark:hover:bg-[#1e1616]/80 dark:hover:text-brand-soft"
            >
              <span className="font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
                {li + 1}.
              </span>{" "}
              <span className="line-clamp-2">{lesson.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildStudySearchParams(
  materialId: string,
  moduleId: number,
  learnMode: boolean,
  /** When set, opens the Focus panel on `/study/quiz` (single practice page). */
  practice?: "focus"
): string {
  const p = new URLSearchParams();
  p.set("material", materialId);
  p.set("module", String(moduleId));
  if (learnMode) p.set("mode", "learn");
  if (practice === "focus") p.set("practice", "focus");
  return p.toString();
}

function pickInitialModuleId(
  payload: CoursePayload,
  urlModule?: number
): number {
  const first = payload.modules[0]?.id ?? 1;
  if (
    urlModule != null &&
    payload.modules.some((m) => m.id === urlModule)
  ) {
    return urlModule;
  }
  return first;
}

export function CoursePlayer({
  course: courseProp,
  courseId,
  materialId,
  sourceLabel,
  initialCompletedModuleIds,
  sidebarOutlines,
  initialModuleFromUrl,
  initialLessonIndex,
  initialScrollPosition,
  mode = "lessons",
  studyHrefBase,
  learnHrefBase,
  courseManageEnabled = true,
  learnMode = false,
  workspaceCourseTitle,
  practiceProgressCourseSummary,
}: {
  course: CoursePayload;
  courseId: string;
  materialId: string;
  sourceLabel: string;
  initialCompletedModuleIds: number[];
  sidebarOutlines: SidebarMaterialOutline[];
  initialModuleFromUrl?: number;
  /** Resume reading position within the active module (Free Exploration). */
  initialLessonIndex?: number;
  initialScrollPosition?: number;
  /** `lessons` = lecture only + link to practice page. `quiz` = review + quiz (no lesson body). */
  mode?: "lessons" | "quiz";
  /** Defaults to dashboard study URL; use `/explore/[courseId]/study` for public learners. */
  studyHrefBase?: string;
  /** Mentored Learning entry URL; derived from `studyHrefBase` when omitted. */
  learnHrefBase?: string;
  /** When false, hide editing, AI refine, and generating more quiz questions (Explore). */
  courseManageEnabled?: boolean;
  /** When true, keep `mode=learn` on lecture/practice URLs (dashboard “study as learner”). */
  learnMode?: boolean;
  /** Workspace title from DB — used in progress drawer when syncing to Profile metrics. */
  workspaceCourseTitle?: string | null;
  /** When set (dashboard quiz), progress drawer matches Profile → Progress for this course. */
  practiceProgressCourseSummary?: CourseLearningSummary | null;
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [course, setCourse] = useState(courseProp);
  const morphingRef = useRef(false);
  const courseRef = useRef(course);
  courseRef.current = course;

  useEffect(() => {
    if (morphingRef.current || refineApplyingRef.current) return;
    setCourse(courseProp);
  }, [courseProp]);

  const studyBase =
    studyHrefBase ?? `/dashboard/courses/${courseId}/study`;
  const learnBase =
    learnHrefBase ??
    (studyHrefBase
      ? studyHrefBase.replace(/\/study\/?$/, "/learn")
      : `/dashboard/courses/${courseId}/learn`);
  const practiceTab =
    mode === "quiz" && searchParams.get("practice") === "focus"
      ? "focus"
      : "module";
  const navigationBasePath = useMemo(
    () => (mode === "quiz" ? `${studyBase}/quiz` : studyBase),
    [mode, studyBase]
  );
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const isDescriptionLong = (course.description?.length ?? 0) > 140;
  const [activeModuleId, setActiveModuleId] = useState(() =>
    pickInitialModuleId(courseProp, initialModuleFromUrl)
  );
  const activeModuleIdRef = useRef(activeModuleId);
  activeModuleIdRef.current = activeModuleId;
  const [completed, setCompleted] = useState<Set<number>>(
    () => new Set(initialCompletedModuleIds)
  );
  const [quizOpen, setQuizOpen] = useState(false);
  const [personalQuizActive, setPersonalQuizActive] = useState(false);
  const [quizSessionEpoch, setQuizSessionEpoch] = useState(0);
  const [missedQuizIndices, setMissedQuizIndices] = useState<number[]>([]);
  const [renamingModuleId, setRenamingModuleId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [manageError, setManageError] = useState<string | null>(null);
  const [busyModuleId, setBusyModuleId] = useState<number | null>(null);
  const [quizAppendBusy, setQuizAppendBusy] = useState(false);
  const [quizAppendError, setQuizAppendError] = useState<string | null>(null);
  const [reviewByIndex, setReviewByIndex] = useState<
    Record<string, QuizReviewStatsDto>
  >({});
  const [lessonJumpVal, setLessonJumpVal] = useState("");
  const [reviewRefreshEpoch, setReviewRefreshEpoch] = useState(0);
  const [progressPanelOpen, setProgressPanelOpen] = useState(false);
  const [personalBankEpoch, setPersonalBankEpoch] = useState(0);
  const [focusItemCount, setFocusItemCount] = useState(0);
  /** True from apply-start until final refresh — banner while Rose writes. */
  const [refineApplying, setRefineApplying] = useState(false);
  /** Module id highlighted (ring) while Rose is editing it. */
  const [refineMorphingModuleId, setRefineMorphingModuleId] = useState<
    number | null
  >(null);
  /** Module using the fallback full-lesson typewriter reveal (no caret ops). */
  const [liveMorphModuleId, setLiveMorphModuleId] = useState<number | null>(
    null
  );
  /**
   * In-place surgical edit currently animating: the caret sits at `caret`
   * inside `text` for lesson (`moduleId`,`lessonIndex`), deleting/typing there.
   */
  const [liveEdit, setLiveEdit] = useState<{
    moduleId: number;
    lessonIndex: number;
    text: string;
    caret: number;
  } | null>(null);
  /**
   * Pre-confirm preview: caret(s) hovering over the exact spans the pending
   * edit will change, shown on the current (unedited) document.
   */
  const [previewEdits, setPreviewEdits] = useState<
    ArosesCourseRefinePreviewEdit[] | null
  >(null);
  const refineApplyingRef = useRef(false);
  // On narrow screens (< lg) the voice dock collapses to a compact trigger so
  // it can't cover the lesson text; tapping it opens a dismissible bottom sheet.
  // On lg+ it always shows, sitting in the reserved right rail.
  const [voiceDockOpen, setVoiceDockOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [askRoseOpen, setAskRoseOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  /** True once we've focused the module being edited (prevents focus-stealing). */
  const refineDidFocusRef = useRef(false);
  /** Timestamp (ms) when the live typewriter for the current edit should finish. */
  const typeDoneAtRef = useRef(0);
  /** Queue of surgical in-place edits (caret animation) waiting to play. */
  const editQueueRef = useRef<
    Array<{
      moduleId: number;
      lessonIndex: number;
      start: number;
      deleteLen: number;
      insert: string;
    }>
  >([]);
  /** True while the caret animation loop is running. */
  const editRunningRef = useRef(false);
  /** Working copy of the lesson being animated, mutated char by char. */
  const liveEditRef = useRef<{
    moduleId: number;
    lessonIndex: number;
    text: string;
    caret: number;
  } | null>(null);
  /** Modules that used surgical caret ops (so patches don't re-type them). */
  const inPlaceModulesRef = useRef<Set<number>>(new Set());
  /** finalizeRefine deferred until the caret animation drains the queue. */
  const pendingFinalizeRef = useRef<(() => void) | null>(null);


  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("aroses_study_sidebar_open");
      if (stored === "0") setSidebarOpen(false);
      if (stored === "1") setSidebarOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setSidebarOpenPersist = useCallback((next: boolean) => {
    setSidebarOpen(next);
    try {
      window.localStorage.setItem(
        "aroses_study_sidebar_open",
        next ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  }, []);
  // True once the user has navigated (module change) since this material loaded.
  // The one-time "resume saved position" effect below checks this so it only
  // restores the saved scroll on the initial page load — never after the user
  // jumps to a new module, which must always start at the top.
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    setRefineApplying(false);
    refineApplyingRef.current = false;
    refineDidFocusRef.current = false;
    typeDoneAtRef.current = 0;
    morphingRef.current = false;
    setRefineMorphingModuleId(null);
    setLiveMorphModuleId(null);
    setLiveEdit(null);
    setPreviewEdits(null);
    editQueueRef.current = [];
    editRunningRef.current = false;
    liveEditRef.current = null;
    inPlaceModulesRef.current = new Set();
    pendingFinalizeRef.current = null;
    hasNavigatedRef.current = false;
  }, [materialId]);

  useEffect(() => {
    // Live "Rose is writing" reveal. We reuse the SAME progressive typewriter
    // the course/notes generation uses (useTypewriterString in
    // LessonEditableBlocks): drop the FINAL edited module into state once and
    // flip it into "live typing" mode, and the lesson types itself out
    // character by character. No incremental pump, and no refresh mid-reveal.
    // Must roughly match LessonEditableBlocks live speed (chars per second).
    const LIVE_CPS = 320;
    let finalizeTimer: ReturnType<typeof setTimeout> | null = null;

    function focusModule(moduleId: number) {
      refineDidFocusRef.current = true;
      if (moduleId !== activeModuleIdRef.current) {
        activeModuleIdRef.current = moduleId;
        setActiveModuleId(moduleId);
        hasNavigatedRef.current = true;
      }
    }

    function finalizeRefine() {
      // If a caret animation is still playing, wait for it to drain first so
      // the last delete/type isn't cut off by the refresh.
      if (editRunningRef.current || editQueueRef.current.length > 0) {
        pendingFinalizeRef.current = finalizeRefine;
        return;
      }
      if (finalizeTimer) {
        clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      pendingFinalizeRef.current = null;
      morphingRef.current = false;
      refineApplyingRef.current = false;
      refineDidFocusRef.current = false;
      typeDoneAtRef.current = 0;
      inPlaceModulesRef.current = new Set();
      liveEditRef.current = null;
      setLiveEdit(null);
      setLiveMorphModuleId(null);
      setRefineMorphingModuleId(null);
      setRefineApplying(false);
      // Content is already final in state (from patches); sync any server-side
      // normalization now that the animation is done — the guard in the
      // courseProp effect lets this apply cleanly.
      router.refresh();
    }

    // Bring the lesson being edited into view so the caret is visible, then
    // play the queued surgical edits one character at a time.
    function scrollLessonIntoView(moduleId: number, lessonIndex: number) {
      if (typeof document === "undefined") return;
      const el = document.getElementById(`lesson-${moduleId}-${lessonIndex}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function runEditQueue() {
      if (editRunningRef.current) return;
      editRunningRef.current = true;

      // Working text per lesson persists for the whole drain so multiple edits
      // to the same lesson stack correctly (and untouched text stays verbatim).
      const workingByKey = new Map<string, string>();
      const keyOf = (m: number, l: number) => `${m}:${l}`;

      let toDelete = 0;
      let toInsert = "";
      let unitsPerTick = 1;

      const seedText = (moduleId: number, lessonIndex: number): string => {
        const k = keyOf(moduleId, lessonIndex);
        const cached = workingByKey.get(k);
        if (cached != null) return cached;
        const mod = courseRef.current.modules.find((m) => m.id === moduleId);
        const text = mod?.lessons[lessonIndex]?.content ?? "";
        workingByKey.set(k, text);
        return text;
      };

      const commitAll = () => {
        if (workingByKey.size === 0) return;
        setCourse((prev) => ({
          ...prev,
          modules: prev.modules.map((m) => {
            let changed = false;
            const lessons = m.lessons.map((l, i) => {
              const v = workingByKey.get(keyOf(m.id, i));
              if (v != null && v !== l.content) {
                changed = true;
                return { ...l, content: v };
              }
              return l;
            });
            return changed ? { ...m, lessons } : m;
          }),
        }));
      };

      const finishQueue = () => {
        commitAll();
        liveEditRef.current = null;
        editRunningRef.current = false;
        if (pendingFinalizeRef.current) {
          const fn = pendingFinalizeRef.current;
          pendingFinalizeRef.current = null;
          fn();
        }
      };

      const startNextChange = (): boolean => {
        const next = editQueueRef.current.shift();
        if (!next) return false;
        const prev = liveEditRef.current;
        const switching =
          !prev ||
          prev.moduleId !== next.moduleId ||
          prev.lessonIndex !== next.lessonIndex;
        const text = seedText(next.moduleId, next.lessonIndex);
        const caret = Math.min(next.start, text.length);
        liveEditRef.current = {
          moduleId: next.moduleId,
          lessonIndex: next.lessonIndex,
          text,
          caret,
        };
        if (switching) scrollLessonIntoView(next.moduleId, next.lessonIndex);
        toDelete = Math.min(next.deleteLen, text.length - caret);
        toInsert = next.insert;
        const units = toDelete + toInsert.length;
        // Pace it so short edits are clearly typed, long ones stay under ~3.5s.
        const durationMs = Math.min(3500, Math.max(250, units * 14));
        unitsPerTick = Math.max(1, Math.ceil(units / (durationMs / 16)));
        return true;
      };

      const tick = () => {
        if (toDelete === 0 && toInsert.length === 0) {
          if (!startNextChange()) {
            finishQueue();
            return;
          }
        }
        const w = liveEditRef.current!;
        let budget = unitsPerTick;
        while (budget > 0 && (toDelete > 0 || toInsert.length > 0)) {
          if (toDelete > 0) {
            w.text = w.text.slice(0, w.caret) + w.text.slice(w.caret + 1);
            toDelete -= 1;
          } else {
            w.text =
              w.text.slice(0, w.caret) + toInsert[0] + w.text.slice(w.caret);
            w.caret += 1;
            toInsert = toInsert.slice(1);
          }
          budget -= 1;
        }
        workingByKey.set(keyOf(w.moduleId, w.lessonIndex), w.text);
        setLiveEdit({ ...w });
        window.setTimeout(tick, 16);
      };

      tick();
    }

    function onApplyStart(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineApplyStartDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      refineApplyingRef.current = true;
      refineDidFocusRef.current = false;
      typeDoneAtRef.current = 0;
      morphingRef.current = true;
      editQueueRef.current = [];
      editRunningRef.current = false;
      liveEditRef.current = null;
      inPlaceModulesRef.current = new Set();
      pendingFinalizeRef.current = null;
      setLiveEdit(null);
      setLiveMorphModuleId(null);
      setPreviewEdits(null);
      setRefineApplying(true);
      // Don't flip live-typing yet — wait for edited content so we don't
      // re-type the unchanged lesson. The floating pill shows progress.
    }

    function onPreview(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefinePreviewDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      if (!d.edits || d.edits.length === 0) {
        setPreviewEdits(null);
        return;
      }
      setPreviewEdits(d.edits);
      // Jump to the module/lesson about to be edited so the caret is visible.
      const first = d.edits[0];
      if (first.moduleId !== activeModuleIdRef.current) {
        activeModuleIdRef.current = first.moduleId;
        setActiveModuleId(first.moduleId);
        hasNavigatedRef.current = true;
      }
      window.setTimeout(
        () => scrollLessonIntoView(first.moduleId, first.lessonIndex),
        140
      );
    }

    function onLessonEdit(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineLessonEditDetail>).detail;
      if (!d || d.materialId !== materialId) return;

      // Focus the edited module once; this is the surgical caret path.
      inPlaceModulesRef.current.add(d.moduleId);
      if (!refineDidFocusRef.current) focusModule(d.moduleId);
      // Only animate the module the student is actually looking at.
      if (d.moduleId !== activeModuleIdRef.current) return;

      setRefineMorphingModuleId(d.moduleId);
      editQueueRef.current.push({
        moduleId: d.moduleId,
        lessonIndex: d.lessonIndex,
        start: d.start,
        deleteLen: d.deleteLen,
        insert: d.insert,
      });
      const units = d.deleteLen + d.insert.length;
      typeDoneAtRef.current = Math.max(
        typeDoneAtRef.current,
        Date.now() + Math.min(3500, Math.max(250, units * 14)) + 250
      );
      runEditQueue();
    }

    function onRefined(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefinedDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      // The edited content is already in state. Let the typewriter finish
      // revealing it, THEN drop the highlight / refresh so nothing is cut off.
      const wait = Math.max(0, typeDoneAtRef.current - Date.now());
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(finalizeRefine, wait + 300);
    }

    function onCancelled(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineApplyCancelledDetail>)
        .detail;
      if (!d || d.materialId !== materialId) return;
      finalizeRefine();
    }

    function onLessonDelta(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefineLessonDeltaDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      // Used only to jump to the module being edited early; the actual reveal
      // is driven by the final module_patch below.
      if (!refineDidFocusRef.current) focusModule(d.moduleId);
    }

    async function onPatch(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefinePatchDetail>).detail;
      if (!d || d.materialId !== materialId || !d.module) return;

      const nextModule = d.module;
      let isActive = nextModule.id === activeModuleIdRef.current;

      // Focus the module being edited ONCE. After that, never yank the student
      // to a different module: other modules update silently in the background
      // so the open lesson isn't replaced by another module's content.
      if (
        !isActive &&
        refineApplyingRef.current &&
        !refineDidFocusRef.current
      ) {
        focusModule(nextModule.id);
        isActive = true;
      }

      const prevModule = courseRef.current.modules.find(
        (m) => m.id === nextModule.id
      );
      // Structured-only edit (key terms / examples): lesson bodies are unchanged.
      // Drop in immediately — never re-type the whole lesson body.
      const structuredOnly =
        !!prevModule &&
        prevModule.lessons.length === nextModule.lessons.length &&
        prevModule.lessons.every(
          (l, i) => (l.content ?? "") === (nextModule.lessons[i]?.content ?? "")
        );

      // Surgical caret path already animated (and will commit) this module —
      // just make sure the authoritative content lands, without re-typing.
      if (inPlaceModulesRef.current.has(nextModule.id) || structuredOnly) {
        const animating =
          !structuredOnly &&
          (liveEditRef.current?.moduleId === nextModule.id ||
            editQueueRef.current.some((c) => c.moduleId === nextModule.id));
        if (!animating) {
          setCourse((prev) => ({
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === nextModule.id ? nextModule : m
            ),
          }));
          if (isActive) {
            setRefineMorphingModuleId(nextModule.id);
            // Brief highlight so key-term / example adds are visible.
            typeDoneAtRef.current = Math.max(
              typeDoneAtRef.current,
              Date.now() + 900
            );
            window.setTimeout(() => {
              setRefineMorphingModuleId((cur) =>
                cur === nextModule.id ? null : cur
              );
            }, 1200);
          }
        }
        setPreviewEdits(null);
        return;
      }

      // Drop the final edited module content into state.
      setCourse((prev) => ({
        ...prev,
        modules: prev.modules.map((m) =>
          m.id === nextModule.id ? nextModule : m
        ),
      }));
      setPreviewEdits(null);

      if (!isActive) return;

      // Fallback reveal (streaming / whole-course / bulk): flip the open module
      // into live-typing mode. LessonEditableBlocks reveals the new content
      // character by character (same typewriter as course/notes generation).
      morphingRef.current = true;
      setRefineMorphingModuleId(nextModule.id);
      setLiveMorphModuleId(nextModule.id);
      const maxLen = nextModule.lessons.reduce(
        (mx, l) => Math.max(mx, (l.content ?? "").length),
        0
      );
      const typeMs = Math.ceil((maxLen / LIVE_CPS) * 1000) + 800;
      typeDoneAtRef.current = Math.max(
        typeDoneAtRef.current,
        Date.now() + typeMs
      );
    }

    window.addEventListener(AROSES_COURSE_REFINE_APPLY_START_EVENT, onApplyStart);
    window.addEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
    window.addEventListener(AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT, onCancelled);
    window.addEventListener(
      AROSES_COURSE_REFINE_LESSON_DELTA_EVENT,
      onLessonDelta
    );
    window.addEventListener(
      AROSES_COURSE_REFINE_LESSON_EDIT_EVENT,
      onLessonEdit
    );
    window.addEventListener(AROSES_COURSE_REFINE_PREVIEW_EVENT, onPreview);
    window.addEventListener(AROSES_COURSE_REFINE_PATCH_EVENT, onPatch);
    return () => {
      window.removeEventListener(
        AROSES_COURSE_REFINE_APPLY_START_EVENT,
        onApplyStart
      );
      window.removeEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
      window.removeEventListener(
        AROSES_COURSE_REFINE_APPLY_CANCELLED_EVENT,
        onCancelled
      );
      window.removeEventListener(
        AROSES_COURSE_REFINE_LESSON_DELTA_EVENT,
        onLessonDelta
      );
      window.removeEventListener(
        AROSES_COURSE_REFINE_LESSON_EDIT_EVENT,
        onLessonEdit
      );
      window.removeEventListener(AROSES_COURSE_REFINE_PREVIEW_EVENT, onPreview);
      window.removeEventListener(AROSES_COURSE_REFINE_PATCH_EVENT, onPatch);
      if (finalizeTimer) clearTimeout(finalizeTimer);
    };
  }, [materialId, router]);

  const bumpPersonalBank = useCallback(() => {
    setPersonalBankEpoch((n) => n + 1);
  }, []);
  useEffect(() => {
    if (practiceTab !== "focus") setPersonalQuizActive(false);
  }, [practiceTab]);

  const prevQuizOpenRef = useRef(quizOpen);
  const prevPersonalQuizActiveRef = useRef(personalQuizActive);

  const bumpReviewRefresh = useCallback(() => {
    setReviewRefreshEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    let bump = false;
    if (prevQuizOpenRef.current && !quizOpen) bump = true;
    if (prevPersonalQuizActiveRef.current && !personalQuizActive) bump = true;
    prevQuizOpenRef.current = quizOpen;
    prevPersonalQuizActiveRef.current = personalQuizActive;
    if (bump) setReviewRefreshEpoch((n) => n + 1);
  }, [quizOpen, personalQuizActive]);

  useEffect(() => {
    if (mode === "lessons") setQuizOpen(false);
  }, [mode]);

  const completedKey = initialCompletedModuleIds.join(",");
  useEffect(() => {
    setCompleted(new Set(initialCompletedModuleIds));
    // materialId + completedKey serialize progress; omit array ref to keep deps stable.
  }, [materialId, completedKey]);

  const moduleIdsKey = course.modules.map((m) => m.id).join(",");
  useEffect(() => {
    const parsed = moduleIdsKey
      ? moduleIdsKey.split(",").map((s) => Number(s.trim()))
      : [];
    const validIds = parsed.filter((n) => Number.isFinite(n));
    if (validIds.length === 0) return;
    if (!validIds.includes(activeModuleId)) {
      setActiveModuleId(validIds[0]);
      setQuizOpen(false);
      setRenamingModuleId(null);
    }
  }, [moduleIdsKey, activeModuleId]);

  useEffect(() => {
    if (
      initialModuleFromUrl != null &&
      course.modules.some((m) => m.id === initialModuleFromUrl)
    ) {
      setActiveModuleId(initialModuleFromUrl);
      setQuizOpen(false);
    }
  }, [initialModuleFromUrl, materialId, moduleIdsKey]);

  const activeModule = useMemo(
    () => course.modules.find((m) => m.id === activeModuleId),
    [course.modules, activeModuleId]
  );

  const scrollToLesson = useCallback(
    (lessonIndex: number, opts?: { persist?: boolean }) => {
      // Read from the ref so this callback's identity stays stable while the
      // course state mutates rapidly during a live refine — otherwise the
      // scroll-restore effect below would re-run on every streamed character
      // and yank the viewport back, blocking the user from scrolling.
      const mod = courseRef.current.modules.find(
        (m) => m.id === activeModuleId
      );
      if (!mod) return;
      document
        .getElementById(`lesson-${mod.id}-${lessonIndex}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (opts?.persist !== false) {
        persistStudyModulePosition(courseId, materialId, activeModuleId, {
          lessonIndex,
          mode: "free",
        });
      }
    },
    [activeModuleId, courseId, materialId]
  );

  useEffect(() => {
    setLessonJumpVal("");
  }, [activeModuleId, materialId]);

  useEffect(() => {
    persistStudyModulePosition(courseId, materialId, activeModuleId, {
      mode: "free",
    });
  }, [courseId, materialId, activeModuleId]);

  useEffect(() => {
    if (mode !== "lessons") return;
    // Only restore the saved scroll/lesson on the initial load. Once the user
    // has navigated to another module, this effect re-runs (activeModuleId is a
    // dep) but must NOT fire, or it would drag the viewport back down using the
    // stale page-load position after we scrolled the new module to the top.
    if (hasNavigatedRef.current) return;
    // Never restore/scroll while a refine is streaming into the page.
    if (refineApplyingRef.current) return;
    const lesson =
      typeof initialLessonIndex === "number" ? initialLessonIndex : null;
    const scroll =
      typeof initialScrollPosition === "number" && initialScrollPosition > 0
        ? initialScrollPosition
        : null;
    if (scroll != null) {
      window.scrollTo(0, scroll);
      return;
    }
    if (lesson != null) {
      const t = window.setTimeout(() => scrollToLesson(lesson, { persist: false }), 80);
      return () => window.clearTimeout(t);
    }
  }, [
    initialLessonIndex,
    initialScrollPosition,
    materialId,
    activeModuleId,
    mode,
    scrollToLesson,
  ]);

  useEffect(() => {
    if (mode !== "lessons") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        touchCourseProgress(courseId, {
          materialId,
          lastModuleId: activeModuleId,
          lastMode: "free",
          lastScrollPosition: Math.round(window.scrollY),
          bumpInteracted: false,
        });
      }, 2000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [activeModuleId, courseId, materialId, mode]);

  useEffect(() => {
    if (!activeModule) {
      setMissedQuizIndices([]);
      return;
    }
    if (mode === "quiz" && practiceTab !== "module") {
      setMissedQuizIndices([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/quiz-missed?moduleId=${activeModule.id}`
        );
        const j = await res.json();
        if (
          !cancelled &&
          res.ok &&
          Array.isArray(j.missedQuizIndices)
        ) {
          setMissedQuizIndices(j.missedQuizIndices);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    practiceTab,
    materialId,
    activeModule?.id,
    quizOpen,
    reviewRefreshEpoch,
  ]);

  useEffect(() => {
    if (mode !== "quiz" || !activeModule) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/quiz-review?moduleId=${activeModule.id}`
        );
        const j = await res.json();
        if (
          !cancelled &&
          res.ok &&
          j.byQuizIndex &&
          typeof j.byQuizIndex === "object"
        ) {
          setReviewByIndex(j.byQuizIndex as Record<string, QuizReviewStatsDto>);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, materialId, activeModule?.id, quizOpen, reviewRefreshEpoch]);

  useEffect(() => {
    if (mode !== "quiz" || !activeModule) {
      setFocusItemCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/personal-quiz-items?moduleId=${activeModule.id}`
        );
        const j = await res.json();
        if (
          !cancelled &&
          res.ok &&
          Array.isArray(j.items)
        ) {
          setFocusItemCount(j.items.length);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    mode,
    materialId,
    activeModule?.id,
    reviewRefreshEpoch,
    personalBankEpoch,
  ]);

  const moduleQuizBank = activeModule?.quiz ?? EMPTY_MODULE_QUIZ;

  const moduleQuizSessionItems = useMemo(() => {
    const items = buildQuizSessionItems(
      moduleQuizBank,
      missedQuizIndices,
      quizSessionEpoch
    );
    console.log("[FREE-EXPLORE] module quiz session", {
      materialId,
      moduleId: activeModule?.id,
      bankSize: moduleQuizBank.length,
      sessionSize: items.length,
      missedCount: missedQuizIndices.length,
      epoch: quizSessionEpoch,
    });
    return items;
  }, [
    moduleQuizBank,
    missedQuizIndices,
    quizSessionEpoch,
    materialId,
    activeModule?.id,
  ]);

  const restartModulePractice = useCallback(() => {
    console.log("[FREE-EXPLORE] practice again", {
      materialId,
      moduleId: activeModule?.id,
    });
    setQuizSessionEpoch((e) => e + 1);
  }, [materialId, activeModule?.id]);

  // Mentored Learning vs. Free Exploration toggle (Phase 1 of the
  // Mentored Learning rollout). New courses default to Mentored.
  const { mode: courseMode, setMode: setCourseMode } =
    useCourseMode(materialId);

  useEffect(() => {
    if (mode !== "lessons") return;
    setCourseMode("free");
    touchCourseProgress(courseId, {
      materialId,
      lastModuleId: activeModuleId,
      lastMode: "free",
    });
  }, [mode, materialId, setCourseMode, courseId, activeModuleId]);

  const moduleQuizPageHref = useMemo(
    () =>
      `${studyBase}/quiz?${buildStudySearchParams(materialId, activeModuleId, learnMode)}`,
    [studyBase, materialId, activeModuleId, learnMode]
  );

  const lecturePageHref = useMemo(
    () =>
      `${studyBase}?${buildStudySearchParams(materialId, activeModuleId, learnMode)}`,
    [studyBase, materialId, activeModuleId, learnMode]
  );

  const selectPracticeTab = useCallback(
    (tab: "module" | "focus") => {
      if (mode !== "quiz") return;
      const q = `?${buildStudySearchParams(
        materialId,
        activeModuleId,
        learnMode,
        tab === "focus" ? "focus" : undefined
      )}`;
      router.replace(`${studyBase}/quiz${q}`, { scroll: false });
      if (tab === "focus") setQuizOpen(false);
    },
    [mode, materialId, activeModuleId, learnMode, router, studyBase]
  );

  /** Keeps `module=` (and practice tab) in the URL when switching modules. */
  const syncModuleToUrl = useCallback(
    (modId: number) => {
      // Snapshot before mutation so the "did the user actually navigate?"
      // check below sees the previous active module.
      const previousModuleId = activeModuleId;
      setActiveModuleId(modId);
      setQuizOpen(false);
      const tab =
        mode === "quiz" && searchParams.get("practice") === "focus"
          ? "focus"
          : "module";
      const q = `?${buildStudySearchParams(
        materialId,
        modId,
        learnMode,
        tab === "focus" ? "focus" : undefined
      )}`;
      router.replace(`${navigationBasePath}${q}`, { scroll: false });
      // Reset scroll on real navigation so a new lesson never starts halfway
      // down the page. We let `router.replace` keep `scroll: false` so the
      // history entry is consistent, then move the viewport ourselves only
      // when the active module actually changed (avoids jumping when the
      // caller just re-syncs the same module, e.g. starting a rename).
      if (typeof window !== "undefined" && previousModuleId !== modId) {
        hasNavigatedRef.current = true;
        window.scrollTo(0, 0);
      }
      persistStudyModulePosition(courseId, materialId, modId, { mode: "free" });
    },
    [
      activeModuleId,
      materialId,
      navigationBasePath,
      router,
      learnMode,
      mode,
      searchParams,
    ]
  );

  const appendModuleQuizQuestions = useCallback(async () => {
    if (!courseManageEnabled || !activeModule) return;
    setQuizAppendBusy(true);
    setQuizAppendError(null);
    try {
      const res = await fetch(
        `/api/study-materials/${materialId}/modules/${activeModule.id}/append-quiz`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: 8 }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setQuizAppendError(
          typeof j.error === "string"
            ? j.error
            : t.study.couldNotGenerateQuestions
        );
        return;
      }
      router.refresh();
    } catch {
      setQuizAppendError(t.study.networkError);
    } finally {
      setQuizAppendBusy(false);
    }
  }, [activeModule, courseManageEnabled, materialId, router, t]);

  const activeModuleIndex = useMemo(
    () => course.modules.findIndex((m) => m.id === activeModuleId),
    [course.modules, activeModuleId]
  );
  const hasNextModule =
    activeModuleIndex >= 0 &&
    activeModuleIndex < course.modules.length - 1;

  // When this is the last module of the current material, find the next
  // material in the sidebar so we can offer a "Move to next upload" button
  // instead of leaving the user stranded with a greyed-out "Next module".
  const nextMaterialInfo = useMemo(() => {
    if (hasNextModule) return null; // Next module exists — no need
    const currentIdx = sidebarOutlines.findIndex((o) => o.materialId === materialId);
    if (currentIdx < 0 || currentIdx >= sidebarOutlines.length - 1) return null;
    const next = sidebarOutlines[currentIdx + 1];
    if (!next || next.modules.length === 0) return null;
    return {
      materialId: next.materialId,
      moduleId: next.modules[0].id,
      fileName: next.fileName,
    };
  }, [hasNextModule, sidebarOutlines, materialId]);

  const totalModules = course.modules.length;
  const completedCount = completed.size;
  const progressPct =
    totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;

  /** Share-bank “mastery”: last-try correct rate among questions with ≥1 attempt. */
  const practiceMasteryPct = useMemo(() => {
    let attempted = 0;
    let correct = 0;
    for (let i = 0; i < moduleQuizBank.length; i++) {
      const st = reviewByIndex[String(i)];
      const n = st?.attemptCount ?? 0;
      if (n > 0) {
        attempted++;
        if (st?.lastIsCorrect === true) correct++;
      }
    }
    if (attempted === 0) return null;
    return Math.round((100 * correct) / attempted);
  }, [moduleQuizBank, reviewByIndex]);

  const alignProgressWithProfile = Boolean(practiceProgressCourseSummary);

  const pullProgressCompleted =
    alignProgressWithProfile && practiceProgressCourseSummary
      ? practiceProgressCourseSummary.modulesCompleted
      : completedCount;
  const pullProgressTotal =
    alignProgressWithProfile && practiceProgressCourseSummary
      ? practiceProgressCourseSummary.modulesTotal
      : totalModules;
  const pullProgressPct =
    pullProgressTotal > 0
      ? Math.round((pullProgressCompleted / pullProgressTotal) * 100)
      : 0;
  const pullMasteryPct =
    alignProgressWithProfile && practiceProgressCourseSummary
      ? practiceProgressCourseSummary.quizAccuracyPct
      : practiceMasteryPct;

  const persistModuleCompletion = useCallback(async (moduleId: number) => {
    console.log("[complete-module] persisting", { materialId, moduleId, courseId });
    const res = await fetch("/api/complete-module", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId, moduleId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[complete-module] failed", { materialId, moduleId, body });
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "Could not save module progress"
      );
    }
    setCompleted((prev) => new Set([...prev, moduleId]));
    console.log("[complete-module] saved", { materialId, moduleId });
    if (alignProgressWithProfile) router.refresh();
  }, [materialId, router, alignProgressWithProfile]);

  const completeModuleOnServer = useCallback(
    async (
      moduleId: number,
      options?: { advanceToNextModule?: boolean }
    ) => {
      await persistModuleCompletion(moduleId);
      setQuizOpen(false);
      if (options?.advanceToNextModule) {
        const ix = course.modules.findIndex((m) => m.id === moduleId);
        const nextMod = ix >= 0 ? course.modules[ix + 1] : undefined;
        if (nextMod) {
          // Always exit to the lessons page (not quiz) so the user sees the
          // lesson content for the next module rather than jumping straight
          // into its quiz.
          const q = `?${buildStudySearchParams(materialId, nextMod.id, learnMode)}`;
          router.push(`${studyBase}${q}`);
        }
      }
    },
    [persistModuleCompletion, course.modules, materialId, learnMode, router, studyBase]
  );

  const handleQuizPassFinished = useCallback(() => {
    if (!activeModule) return;
    void persistModuleCompletion(activeModule.id).catch(() => {});
    bumpReviewRefresh();
  }, [activeModule, persistModuleCompletion, bumpReviewRefresh]);

  const handleModuleQuizComplete = useCallback(
    async (choice: "review_lessons" | "next_module") => {
      if (!activeModule) return;
      if (choice === "next_module") {
        await completeModuleOnServer(activeModule.id, {
          advanceToNextModule: true,
        });
        return;
      }
      if (mode === "quiz") {
        setQuizOpen(false);
        router.push(lecturePageHref);
        return;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [
      activeModule,
      completeModuleOnServer,
      lecturePageHref,
      mode,
      router,
    ]
  );

  function beginRename(mod: CourseModule) {
    setManageError(null);
    setRenamingModuleId(mod.id);
    // Prefill with the title the user actually sees (descriptive), not the raw
    // weak label — saving then persists the good title to module.title.
    setRenameDraft(moduleDisplayTitle(mod));
    syncModuleToUrl(mod.id);
  }

  function cancelRename() {
    setRenamingModuleId(null);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (renamingModuleId === null) return;
    const title = renameDraft.trim();
    if (title.length < 1 || title.length > 200) {
      setManageError(t.study.titleLengthError);
      return;
    }

    setBusyModuleId(renamingModuleId);
    setManageError(null);
    try {
      const res = await fetch(
        `/api/study-materials/${materialId}/modules/${renamingModuleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setManageError(
          typeof body.error === "string" ? body.error : t.study.couldNotRename
        );
        setBusyModuleId(null);
        return;
      }
      setRenamingModuleId(null);
      router.refresh();
    } catch {
      setManageError(t.study.networkError);
    }
    setBusyModuleId(null);
  }

  async function deleteModule(modId: number) {
    if (course.modules.length <= 1) return;

    const ok = await confirmDialog({
      title: t.study.deleteModuleTitle,
      body: t.study.deleteModuleBody,
      confirmLabel: t.study.delete,
      tone: "danger",
    });
    if (!ok) return;

    setBusyModuleId(modId);
    setManageError(null);
    try {
      const res = await fetch(
        `/api/study-materials/${materialId}/modules/${modId}`,
        { method: "DELETE" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setManageError(
          typeof body.error === "string" ? body.error : t.study.couldNotDelete
        );
        setBusyModuleId(null);
        return;
      }
      setRenamingModuleId(null);
      router.refresh();
    } catch {
      setManageError(t.study.networkError);
    }
    setBusyModuleId(null);
  }

  const goToModule = useCallback(
    (targetMaterialId: string, modId: number) => {
      const previousModuleId = activeModuleId;
      const isSameMaterial = targetMaterialId === materialId;
      setQuizOpen(false);
      setRenamingModuleId(null);
      const tab =
        mode === "quiz" && searchParams.get("practice") === "focus"
          ? "focus"
          : "module";
      const q = `?${buildStudySearchParams(
        targetMaterialId,
        modId,
        learnMode,
        tab === "focus" ? "focus" : undefined
      )}`;
      if (isSameMaterial) {
        setActiveModuleId(modId);
        router.replace(`${navigationBasePath}${q}`, { scroll: false });
      } else {
        router.push(`${navigationBasePath}${q}`);
      }
      // Reset scroll so a freshly-clicked module never opens halfway down
      // the page. For cross-material navigation (`router.push`) Next.js
      // already scrolls, but doing it eagerly here also avoids a flash of
      // the old scroll position before the new page mounts.
      if (
        typeof window !== "undefined" &&
        (!isSameMaterial || previousModuleId !== modId)
      ) {
        hasNavigatedRef.current = true;
        window.scrollTo(0, 0);
      }
    },
    [activeModuleId, materialId, navigationBasePath, router, learnMode, mode, searchParams]
  );

  const showAccordion = sidebarOutlines.length > 0;

  const outlinesKey = sidebarOutlines.map((o) => o.materialId).join(",");
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(
    () => new Set(sidebarOutlines.map((o) => o.materialId))
  );

  useEffect(() => {
    setExpandedMaterialIds(new Set(sidebarOutlines.map((o) => o.materialId)));
  }, [outlinesKey]);

  function toggleMaterialSection(materialSectionId: string) {
    setExpandedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(materialSectionId)) next.delete(materialSectionId);
      else next.add(materialSectionId);
      return next;
    });
  }

  const courseMixHref = useMemo(() => {
    if (
      mode !== "quiz" ||
      practiceTab !== "module" ||
      !courseManageEnabled
    )
      return null;
    const p = new URLSearchParams();
    p.set("material", materialId);
    p.set("module", String(activeModuleId));
    if (learnMode) p.set("mode", "learn");
    return `/dashboard/courses/${courseId}/study/course-mix?${p.toString()}`;
  }, [
    mode,
    courseManageEnabled,
    courseId,
    materialId,
    activeModuleId,
    learnMode,
    practiceTab,
  ]);

  if (!activeModule) {
    return (
      <p className="text-sm text-zinc-500">{t.study.noModules}</p>
    );
  }

  return (
    <>
      {refineApplying && courseManageEnabled ? (
        <div className="fixed bottom-5 left-5 z-[95] flex items-center gap-2.5 rounded-full border border-zinc-200 bg-white/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            {AI_ASSISTANT_NAME} is editing
          </span>
          <button
            type="button"
            onClick={() => stopRefineApplyJob(materialId)}
            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:bg-zinc-950 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Stop
          </button>
        </div>
      ) : null}
    <div
      className="flex min-h-[calc(100vh-3.5rem)] flex-col lg:flex-row"
      style={
        {
          // Width the floating voice/refine dock occupies, plus breathing room.
          // The lesson column reserves this as right padding on xl+ (where the
          // sidebar + content + dock all fit) so the dock can never overlap the
          // content. Below xl the dock collapses to a trigger and content fills.
          "--rose-dock-w": "min(16rem, calc(100vw - 2rem))",
          "--rose-dock-rail": "calc(var(--rose-dock-w) + 3rem)",
        } as CSSProperties
      }
    >
      <aside
        className={`border-zinc-200/90 bg-white transition-[width] duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-950 ${
          sidebarOpen
            ? // Sticky viewport-height column + inner scroll — do NOT put
              // overflow-hidden on this aside alone or expanded modules get
              // clipped mid-card with no way to reach the rest.
              "w-full border-b bg-gradient-to-b from-zinc-50 to-white lg:sticky lg:top-14 lg:flex lg:h-[calc(100vh-3.5rem)] lg:w-[22rem] lg:shrink-0 lg:flex-col lg:self-start lg:overflow-hidden lg:border-b-0 lg:border-r dark:from-zinc-950 dark:to-zinc-950"
            : // Sticky so the collapsed module dots follow scroll. (overflow-hidden
              // on this aside used to break sticky and let the rail scroll away.)
              "max-lg:hidden lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-14 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-r"
        }`}
      >
        {!sidebarOpen ? (
          <div className="flex h-full w-14 flex-col items-center gap-1 py-3">
            <button
              type="button"
              onClick={() => setSidebarOpenPersist(true)}
              aria-expanded={false}
              aria-label={t.study.showModules}
              title={t.study.showModules}
              className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <nav
              className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1.5 pb-2"
              aria-label={t.study.curriculum}
            >
              {course.modules.map((mod) => {
                const done = completed.has(mod.id);
                const active = mod.id === activeModuleId;
                const title = moduleDisplayTitle(mod);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => syncModuleToUrl(mod.id)}
                    aria-label={title}
                    aria-current={active ? "true" : undefined}
                    title={title}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                      active
                        ? "bg-white shadow-sm ring-1 ring-brand-border dark:bg-zinc-900 dark:ring-brand-border/40"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                        done
                          ? "bg-emerald-500 text-white"
                          : active
                            ? "border border-brand/40 bg-brand-blush text-brand dark:border-brand/50 dark:bg-[#1e1616] dark:text-brand-soft"
                            : "border border-zinc-300 bg-white text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400"
                      }`}
                    >
                      {done ? "✓" : mod.id}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        ) : (
        <div className="w-full min-w-[min(100%,22rem)] space-y-6 p-6 lg:min-h-0 lg:w-[22rem] lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                {courseManageEnabled ? t.study.yourCourse : t.study.course}
              </p>
              <button
                type="button"
                onClick={() => setSidebarOpenPersist(false)}
                aria-expanded={sidebarOpen}
                aria-label={t.study.hideModules}
                title={t.study.hideModules}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </div>
            <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
              {course.title}
            </h1>
            {course.description ? (
              <>
                <p
                  className={`mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 ${
                    isDescriptionLong && !descriptionExpanded
                      ? "line-clamp-3"
                      : ""
                  }`}
                >
                  {course.description}
                </p>
                {isDescriptionLong ? (
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded((v) => !v)}
                    className="mt-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {descriptionExpanded ? t.study.showLess : t.study.showMore}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <span>{t.study.thisUpload}</span>
              <span>
                {tf(t.study.modulesProgress, {
                  completed: completedCount,
                  total: totalModules,
                })}
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-200/90 ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-hover transition-[width] duration-500 ease-out dark:from-brand dark:to-brand-hover"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {courseMixHref ? (
              <Link
                href={courseMixHref}
                className="mt-3 flex w-full items-center justify-center rounded-full border border-zinc-200 bg-white px-3 py-2 text-center text-[11px] font-semibold leading-snug text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {t.study.wholeCourseMixedQuiz}
              </Link>
            ) : null}
          </div>

          <nav className="space-y-3">
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {showAccordion ? t.study.allMaterials : t.study.curriculum}
            </p>
            {manageError && (
              <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {manageError}
              </p>
            )}
            {showAccordion
              ? (() => {
                  // Group materials by section. Preserve insertion order of sections.
                  const hasSections = sidebarOutlines.some((o) => o.examGroupId);
                  if (!hasSections) {
                    // No section data — render flat list as before
                    return sidebarOutlines.map((outline) => renderMaterialCard(outline));
                  }

                  // Build ordered section groups
                  const seen = new Map<string, { name: string; outlines: typeof sidebarOutlines }>();
                  for (const o of sidebarOutlines) {
                    const key = o.examGroupId ?? "__none__";
                    const name =
                      o.examGroupName ??
                      (o.examGroupId ? t.study.section : t.study.other);
                    if (!seen.has(key)) seen.set(key, { name, outlines: [] });
                    seen.get(key)!.outlines.push(o);
                  }

                  return Array.from(seen.entries()).map(([groupKey, { name, outlines }]) => (
                    <div key={groupKey} className="space-y-2">
                      <p className="px-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-brand dark:text-brand-soft">
                        {name}
                      </p>
                      <div className="space-y-2">
                        {outlines.map((outline) => renderMaterialCard(outline))}
                      </div>
                    </div>
                  ));

                  function renderMaterialCard(outline: (typeof sidebarOutlines)[number]) {
                  const doneCount = outline.completedModuleIds.length;
                  const totalM = outline.modules.length;
                  const isOpenBuild = outline.materialId === materialId;
                  const expanded = expandedMaterialIds.has(outline.materialId);

                  return (
                    <div
                      key={outline.materialId}
                      className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/40"
                    >
                      <button
                        type="button"
                        onClick={() => toggleMaterialSection(outline.materialId)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-zinc-900 dark:text-zinc-100"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="text-zinc-400" aria-hidden>
                            {expanded ? "▼" : "▶"}
                          </span>
                          <span className="min-w-0 truncate">
                            {outline.fileName}
                          </span>
                          {isOpenBuild ? (
                            <span className="shrink-0 rounded bg-brand-blush px-1.5 py-0 text-[9px] font-bold uppercase text-brand dark:bg-[#1e1616] dark:text-brand-soft">
                              {t.study.viewing}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {doneCount}/{totalM}
                        </span>
                      </button>
                      {expanded ? (
                      <div className="space-y-1 border-t border-zinc-100 px-2 py-2 dark:border-zinc-800">
                        {outline.modules.map((mod) => {
                          const done = isOpenBuild
                            ? completed.has(mod.id)
                            : outline.completedModuleIds.includes(mod.id);
                          const rowActive =
                            isOpenBuild && mod.id === activeModuleId;
                          const busy = busyModuleId === mod.id;

                          if (isOpenBuild && renamingModuleId === mod.id) {
                            const fullMod = course.modules.find(
                              (m) => m.id === mod.id
                            );
                            if (!fullMod) return null;
                            return (
                              <form
                                key={mod.id}
                                onSubmit={(e) => void saveRename(e)}
                                className="rounded-xl border border-brand-border bg-white p-3 shadow-sm dark:border-brand-border/40 dark:bg-zinc-900"
                              >
                                <label
                                  className="sr-only"
                                  htmlFor={`rename-${mod.id}`}
                                >
                                  {t.study.moduleTitle}
                                </label>
                                <input
                                  id={`rename-${mod.id}`}
                                  value={renameDraft}
                                  onChange={(e) =>
                                    setRenameDraft(e.target.value)
                                  }
                                  disabled={busy}
                                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  autoFocus
                                />
                                <div className="mt-2 flex gap-2">
                                  <button
                                    type="submit"
                                    disabled={busy}
                                    className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                                  >
                                    {t.study.save}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={cancelRename}
                                    className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                  >
                                    {t.study.cancel}
                                  </button>
                                </div>
                              </form>
                            );
                          }

                          if (isOpenBuild) {
                            const fullMod = course.modules.find(
                              (m) => m.id === mod.id
                            );
                            if (!fullMod) return null;
                            return (
                              <Fragment key={mod.id}>
                                <div
                                  className={`flex gap-1 rounded-xl p-1 transition-[background-color,box-shadow] duration-200 ease-out ${
                                    rowActive
                                      ? "bg-white shadow-md shadow-red-500/10 ring-1 ring-brand-border dark:bg-zinc-900 dark:ring-brand-border/40"
                                      : "hover:bg-white/60 dark:hover:bg-zinc-900/50"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      goToModule(outline.materialId, mod.id)
                                    }
                                    className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left text-sm ${
                                      rowActive
                                        ? "font-medium text-brand dark:text-brand-soft"
                                        : "text-zinc-700 dark:text-zinc-300"
                                    }`}
                                  >
                                    <span
                                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                        done
                                          ? "bg-emerald-500 text-white"
                                          : "border border-zinc-300 bg-white text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
                                      }`}
                                    >
                                      {done ? "✓" : mod.id}
                                    </span>
                                    <span className="leading-snug">
                                      {moduleDisplayTitle(fullMod)}
                                    </span>
                                  </button>
                                  {courseManageEnabled ? (
                                    <div className="flex shrink-0 flex-col justify-center gap-0.5 py-1 pr-1">
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => beginRename(fullMod)}
                                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-brand-blush hover:text-brand disabled:opacity-40 dark:hover:bg-[#1e1616]/50 dark:hover:text-brand-soft"
                                      >
                                        {t.study.rename}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          busy || course.modules.length <= 1
                                        }
                                        onClick={() =>
                                          void deleteModule(mod.id)
                                        }
                                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40 dark:text-red-400"
                                      >
                                        {t.study.delete}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                                {rowActive && mode === "lessons" ? (
                                  <ModuleLessonJumpNav
                                    lessons={fullMod.lessons}
                                    onJump={scrollToLesson}
                                  />
                                ) : null}
                              </Fragment>
                            );
                          }

                          return (
                            <button
                              key={mod.id}
                              type="button"
                              onClick={() =>
                                goToModule(outline.materialId, mod.id)
                              }
                              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm text-zinc-700 hover:bg-white/80 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                            >
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                  done
                                    ? "bg-emerald-500 text-white"
                                    : "border border-zinc-300 bg-white text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
                                }`}
                              >
                                {done ? "✓" : mod.id}
                              </span>
                              <span className="leading-snug">
                                {moduleDisplayTitle(mod)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      ) : null}
                    </div>
                  );
                  } // end renderMaterialCard
                })()
              : course.modules.map((mod) => {
                  const done = completed.has(mod.id);
                  const active = mod.id === activeModuleId;
                  const busy = busyModuleId === mod.id;

                  if (renamingModuleId === mod.id) {
                    return (
                      <form
                        key={mod.id}
                        onSubmit={(e) => void saveRename(e)}
                        className="rounded-xl border border-brand-border bg-white p-3 shadow-sm dark:border-brand-border/40 dark:bg-zinc-900"
                      >
                        <label
                          className="sr-only"
                          htmlFor={`rename-${mod.id}`}
                        >
                          {t.study.moduleTitle}
                        </label>
                        <input
                          id={`rename-${mod.id}`}
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          disabled={busy}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                          autoFocus
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="submit"
                            disabled={busy}
                            className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                          >
                            {t.study.save}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={cancelRename}
                            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            {t.study.cancel}
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <Fragment key={mod.id}>
                      <div
                        className={`flex gap-1 rounded-xl p-1 transition-[background-color,box-shadow] duration-200 ease-out ${
                          active
                            ? "bg-white shadow-md shadow-red-500/10 ring-1 ring-brand-border dark:bg-zinc-900 dark:ring-brand-border/40"
                            : "hover:bg-white/60 dark:hover:bg-zinc-900/50"
                        }`}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => syncModuleToUrl(mod.id)}
                          className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left text-sm ${
                            active
                              ? "font-medium text-brand dark:text-brand-soft"
                              : "text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                              done
                                ? "bg-emerald-500 text-white"
                                : "border border-zinc-300 bg-white text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
                            }`}
                          >
                            {done ? "✓" : mod.id}
                          </span>
                          <span className="leading-snug">{moduleDisplayTitle(mod)}</span>
                        </button>
                        {courseManageEnabled ? (
                          <div className="flex shrink-0 flex-col justify-center gap-0.5 py-1 pr-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => beginRename(mod)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-brand-blush hover:text-brand disabled:opacity-40 dark:hover:bg-[#1e1616]/50 dark:hover:text-brand-soft"
                            >
                              {t.study.rename}
                            </button>
                            <button
                              type="button"
                              disabled={busy || course.modules.length <= 1}
                              onClick={() => void deleteModule(mod.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40 dark:text-red-400"
                            >
                              {t.study.delete}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {active && mode === "lessons" ? (
                        <ModuleLessonJumpNav
                          lessons={mod.lessons}
                          onJump={scrollToLesson}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
          </nav>

          <p className="text-[11px] text-zinc-500">
            {t.study.sourceFile}{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-400">
              {sourceLabel}
            </span>
          </p>
        </div>
        )}
      </aside>

      <div
        className={`relative min-w-0 flex-1 bg-white transition-[padding] duration-300 ease-out dark:bg-zinc-950 ${
          askRoseOpen || refineOpen
            ? "lg:pr-[min(100vw-16px,28rem)]"
            : "xl:pr-[var(--rose-dock-rail)]"
        }`}
      >
        {!sidebarOpen ? (
          <button
            type="button"
            onClick={() => setSidebarOpenPersist(true)}
            aria-expanded={false}
            aria-label={t.study.showModules}
            title={t.study.showModules}
            className="absolute left-2 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm backdrop-blur transition hover:bg-zinc-50 lg:hidden dark:border-zinc-700 dark:bg-zinc-950/95 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            {t.study.showModules}
          </button>
        ) : null}
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          {mode === "quiz" ? (
            <div className="mb-3">
              <Link
                href={lecturePageHref}
                className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm ring-1 ring-black/5 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-white/10 dark:hover:bg-zinc-900"
              >
                {t.study.backToLecture}
              </Link>
            </div>
          ) : null}
          <AiStudyDisclaimer className="mb-3" />
          {mode === "lessons" ? (
            <>
              <CourseModeToggle
                mode={courseMode}
                onChange={(next) => {
                  console.log("[mode-persist] toggle", {
                    courseId,
                    materialId,
                    next,
                  });
                  if (next === "mentored") {
                    setCourseMode("mentored");
                    touchCourseProgress(courseId, {
                      materialId,
                      lastModuleId: activeModule.id,
                      lastMode: "mentored",
                    });
                    fetch(`/api/mentored/mode/${materialId}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "mentored" }),
                    }).catch(() => {});
                    const qs = new URLSearchParams();
                    qs.set("material", materialId);
                    qs.set("module", String(activeModule.id));
                    router.push(`${learnBase}?${qs.toString()}`);
                  } else {
                    setCourseMode("free");
                    touchCourseProgress(courseId, {
                      materialId,
                      lastModuleId: activeModule.id,
                      lastMode: "free",
                    });
                    fetch(`/api/mentored/mode/${materialId}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "free" }),
                    }).catch(() => {});
                  }
                }}
                hint={t.study.modeToggleHint}
              />
              <header className="border-b border-zinc-100 pb-4 dark:border-zinc-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  {tf(t.study.moduleLabel, { id: activeModule.id })}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {moduleDisplayTitle(activeModule)}
                </h2>
              </header>

              {activeModule.lessons.length > 1 ? (
                <div className="mt-6 lg:hidden">
                  <label
                    htmlFor="lesson-jump-select"
                    className="sr-only"
                  >
                    {t.study.jumpToLesson}
                  </label>
                  <select
                    id="lesson-jump-select"
                    value={lessonJumpVal}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return;
                      scrollToLesson(Number(v));
                      setLessonJumpVal("");
                    }}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-soft dark:focus:ring-brand-soft/20"
                  >
                    <option value="">{t.study.jumpToLessonPlaceholder}</option>
                    {activeModule.lessons.map((lesson, li) => (
                      <option key={li} value={String(li)}>
                        {li + 1}. {lesson.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="mt-6 space-y-10 pb-[max(13rem,calc(11rem+env(safe-area-inset-bottom)))] xl:pb-16">
                {activeModule.lessons.map((lesson, li) => (
                  <div
                    key={li}
                    id={`lesson-${activeModule.id}-${li}`}
                    className={`scroll-mt-24 ${
                      refineMorphingModuleId === activeModule.id ||
                      previewEdits?.[0]?.moduleId === activeModule.id
                        ? "rounded-xl ring-2 ring-brand/40 ring-offset-2 ring-offset-white dark:ring-brand-soft/50 dark:ring-offset-zinc-950"
                        : ""
                    }`}
                  >
                    <LessonEditableBlocks
                      materialId={materialId}
                      moduleId={activeModule.id}
                      lessonIndex={li}
                      lesson={lesson}
                      readOnly={!courseManageEnabled}
                      liveMorphing={liveMorphModuleId === activeModule.id}
                      liveEditText={
                        liveEdit &&
                        liveEdit.moduleId === activeModule.id &&
                        liveEdit.lessonIndex === li
                          ? liveEdit.text
                          : null
                      }
                      liveEditCaret={
                        liveEdit &&
                        liveEdit.moduleId === activeModule.id &&
                        liveEdit.lessonIndex === li
                          ? liveEdit.caret
                          : null
                      }
                      previewEdits={
                        previewEdits
                          ? previewEdits.filter(
                              (e) =>
                                e.moduleId === activeModule.id &&
                                e.lessonIndex === li
                            )
                          : null
                      }
                    />
                    <LessonNotesCapture
                      materialId={materialId}
                      moduleId={activeModule.id}
                      lessonIndex={li}
                      lessonTitle={lesson.title}
                    />
                  </div>
                ))}

                {hasNextModule && activeModuleIndex >= 0 ? (
                  <div className="flex justify-end border-t border-zinc-100 pt-6 dark:border-zinc-900">
                    <button
                      type="button"
                      onClick={() =>
                        syncModuleToUrl(course.modules[activeModuleIndex + 1].id)
                      }
                      className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                    >
                      {t.study.nextModule}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-14 rounded-2xl border border-brand-border bg-gradient-to-br from-brand-blush/90 to-white p-6 shadow-sm dark:border-brand-border/40 dark:from-[#1e1616]/40 dark:to-zinc-950">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t.study.practiceAndReview}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {t.study.practiceAndReviewBody}
                </p>
                {completed.has(activeModule.id) ? (
                  <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-2.5 text-sm font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                    {t.study.moduleCompleteBanner}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={moduleQuizPageHref}
                    className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                  >
                    {t.study.goToPracticeRoom}
                    {moduleQuizBank.length > 0 ? (
                      <span className="ml-2 inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold tabular-nums">
                        {moduleQuizBank.length}
                      </span>
                    ) : null}
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <>
              <header className="border-b border-zinc-100 pb-5 dark:border-zinc-900">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                    {tf(t.study.moduleLabel, { id: activeModule.id })}
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {activeModule.title}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    {t.study.practiceIntroBeforeModule}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {t.study.moduleQuiz}
                    </span>
                    {t.study.practiceIntroBetween}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {t.study.focusQuiz}
                    </span>
                    {t.study.practiceIntroAfter}
                  </p>
                </div>
                <div
                  className="mt-5 flex flex-wrap gap-2"
                  role="tablist"
                  aria-label={t.study.practiceType}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={practiceTab === "module"}
                    id="practice-tab-module"
                    tabIndex={practiceTab === "module" ? 0 : -1}
                    onClick={() => selectPracticeTab("module")}
                    className={
                      practiceTab === "module"
                        ? "inline-flex items-center gap-2 rounded-full border border-brand bg-brand-blush/95 px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm shadow-brand/10 dark:border-brand-soft dark:bg-white/[0.14] dark:text-white dark:shadow-none dark:ring-1 dark:ring-brand-soft/45"
                        : "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600"
                    }
                  >
                    <span>{t.study.moduleQuiz}</span>
                    <span
                      className={
                        practiceTab === "module"
                          ? "rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-100"
                          : "text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
                      }
                    >
                      {moduleQuizBank.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={practiceTab === "focus"}
                    id="practice-tab-focus"
                    tabIndex={practiceTab === "focus" ? 0 : -1}
                    onClick={() => selectPracticeTab("focus")}
                    className={
                      practiceTab === "focus"
                        ? "inline-flex items-center gap-2 rounded-full border border-brand bg-brand-blush/95 px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm shadow-brand/10 dark:border-brand-soft dark:bg-white/[0.14] dark:text-white dark:shadow-none dark:ring-1 dark:ring-brand-soft/45"
                        : "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600"
                    }
                  >
                    <span>{t.study.focusQuiz}</span>
                    <span
                      className={
                        practiceTab === "focus"
                          ? "rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-100"
                          : "text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
                      }
                    >
                      {focusItemCount}
                    </span>
                  </button>
                </div>
              </header>

              {practiceTab === "module" ? (
                <>
                  <section className="pt-6">
                    <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/90 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
                      <div className="border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-700/80">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {t.study.moduleBankReview}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {t.study.moduleBankReviewDesc}
                        </p>
                      </div>
                      <div className="p-3 sm:p-4">
                        {moduleQuizBank.length === 0 ? (
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {t.study.noBankQuestions}
                            {courseManageEnabled
                              ? ` ${t.study.generateBatchHint}`
                              : ""}
                          </p>
                        ) : (
                          <ModuleQuizReview
                            showHeader={false}
                            compact
                            embedded
                            bankScopeHint={tf(t.study.moduleQuizBankScope, {
                              id: activeModule.id,
                            })}
                            quiz={moduleQuizBank}
                            reviewByIndex={reviewByIndex}
                            scrollAreaClassName="max-h-[min(52vh,26rem)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200/70 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/25"
                          />
                        )}
                      </div>
                    </div>
                  </section>

                  <div className="mt-9 border-t border-zinc-100 pt-6 dark:border-zinc-900">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {t.study.moduleQuiz}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {t.study.moduleQuizDescBefore}
                      <button
                        type="button"
                        onClick={() => selectPracticeTab("focus")}
                        className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
                      >
                        {t.study.focusQuiz}
                      </button>
                      {t.study.moduleQuizDescAfter}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {courseManageEnabled ? (
                        <>
                          <button
                            type="button"
                            disabled={quizAppendBusy || !activeModule}
                            onClick={() => void appendModuleQuizQuestions()}
                            className="inline-flex items-center justify-center rounded-full border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-ink shadow-sm hover:bg-brand-blush disabled:opacity-50 dark:border-brand-border/50 dark:bg-zinc-950 dark:text-brand-soft dark:hover:bg-brand-blush/10"
                          >
                            {quizAppendBusy
                              ? t.study.generatingQuestions
                              : t.study.generateMoreQuestions}
                          </button>
                          {moduleQuizBank.length > 0 ? (
                            <span className="text-xs text-zinc-500">
                              {moduleQuizBank.length === 1
                                ? t.study.bankCountOne
                                : tf(t.study.bankCount, {
                                    count: moduleQuizBank.length,
                                  })}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
                              {t.study.noQuestionsYetGenerate}
                            </span>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {t.study.bankManagedByCreator}
                          {moduleQuizBank.length > 0 ? (
                            <>
                              {" "}
                              {moduleQuizBank.length === 1
                                ? t.study.bankCountShortOne
                                : tf(t.study.bankCountShort, {
                                    count: moduleQuizBank.length,
                                  })}
                            </>
                          ) : (
                            <> {t.study.noQuestionsInModule}</>
                          )}
                        </p>
                      )}
                    </div>
                    {quizAppendError ? (
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                        {quizAppendError}
                      </p>
                    ) : null}
                    {missedQuizIndices.length > 0 ? (
                      <div className="mt-5 rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-4 dark:border-amber-900/60 dark:bg-amber-950/30">
                        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                          {missedQuizIndices.length === 1
                            ? t.study.reviewQueueOne
                            : tf(t.study.reviewQueue, {
                                count: missedQuizIndices.length,
                              })}
                        </p>
                        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                          {t.study.reviewQueueDesc}
                        </p>
                        <ul className="mt-3 space-y-2 border-t border-amber-200/60 pt-3 dark:border-amber-900/40">
                          {missedQuizIndices.slice(0, 5).map((qi) => {
                            const item = activeModule.quiz[qi];
                            if (!item) return null;
                            return (
                              <li
                                key={qi}
                                className="line-clamp-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                              >
                                {item.question}
                              </li>
                            );
                          })}
                        </ul>
                        {missedQuizIndices.length > 5 ? (
                          <p className="mt-2 text-[11px] text-amber-800/80 dark:text-amber-300/70">
                            {tf(t.study.moreInModule, {
                              count: missedQuizIndices.length - 5,
                            })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {moduleQuizBank.length === 0 ? null : !quizOpen ? (
                      <button
                        type="button"
                        disabled={personalQuizActive}
                        onClick={() => {
                          setQuizSessionEpoch((e) => e + 1);
                          setQuizOpen(true);
                          requestAnimationFrame(() => {
                            document
                              .getElementById("module-quiz-run")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          });
                        }}
                        title={
                          personalQuizActive
                            ? t.study.finishFocusQuizFirst
                            : undefined
                        }
                        className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
                      >
                        {t.study.startModuleQuiz}
                      </button>
                    ) : (
                      <div
                        id="module-quiz-run"
                        className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50/50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/30 sm:p-7"
                      >
                        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200/80 pb-5 dark:border-zinc-800">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
                              {t.study.moduleQuizRun}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                              {activeModule.title}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setQuizOpen(false)}
                            className="shrink-0 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          >
                            {t.study.backToOverview}
                          </button>
                        </div>
                        <ModuleQuiz
                          key={`quiz-${activeModule.id}-${quizSessionEpoch}`}
                          materialId={materialId}
                          moduleId={activeModule.id}
                          items={moduleQuizSessionItems}
                          shuffleEpoch={quizSessionEpoch}
                          hasNextModule={hasNextModule}
                          nextMaterialFileName={nextMaterialInfo?.fileName}
                          onPassFinished={handleQuizPassFinished}
                          onAttemptRecorded={bumpReviewRefresh}
                          onPracticeAgain={restartModulePractice}
                          onCompleteQuiz={handleModuleQuizComplete}
                          onNextMaterial={
                            nextMaterialInfo
                              ? () => {
                                  const q = `?${buildStudySearchParams(
                                    nextMaterialInfo.materialId,
                                    nextMaterialInfo.moduleId,
                                    learnMode
                                  )}`;
                                  router.push(`${studyBase}${q}`);
                                }
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : activeModule ? (
                <PersonalQuizSection
                  sectionClassName="mt-0 border-t-0 pt-6"
                  materialId={materialId}
                  moduleId={activeModule.id}
                  blocked={quizOpen}
                  hasNextModule={hasNextModule}
                  onRunOpenChange={setPersonalQuizActive}
                  onPersonalQuizBankChanged={bumpPersonalBank}
                  onAdvanceModule={() => {
                    const ix = course.modules.findIndex(
                      (m) => m.id === activeModule.id
                    );
                    const next = course.modules[ix + 1];
                    if (next) syncModuleToUrl(next.id);
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&>*]:pointer-events-auto">
      {/* Compact trigger — below xl only, when the voice dock is closed. */}
      {!voiceDockOpen ? (
        <button
          type="button"
          onClick={() => setVoiceDockOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border-2 border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-xl transition hover:border-brand hover:text-brand xl:hidden dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          aria-expanded={false}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500"
            aria-hidden
          />
          {`Ask ${AI_ASSISTANT_NAME}`}
        </button>
      ) : null}

      {/*
        Single VoiceTutorDock instance, repositioned responsively:
        - xl+: inline in this cluster, which sits inside the reserved right rail.
        - < xl, open: dismissible bottom sheet that overlays (user-invoked).
        - < xl, closed: display:none (kept mounted to preserve mic state).
      */}
      <div
        className={
          voiceDockOpen
            ? "fixed inset-x-3 bottom-3 z-[110] flex max-h-[80dvh] flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-zinc-200/90 bg-white/95 p-3 shadow-2xl backdrop-blur xl:static xl:inset-auto xl:z-auto xl:max-h-none xl:w-auto xl:items-end xl:overflow-visible xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none xl:backdrop-blur-none dark:border-zinc-700 dark:bg-zinc-900/95"
            : "hidden xl:flex xl:flex-col xl:items-end xl:gap-3"
        }
      >
        {voiceDockOpen ? (
          <button
            type="button"
            onClick={() => setVoiceDockOpen(false)}
            className="self-end rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 xl:hidden dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        ) : null}
        <VoiceTutorDock
          key={`${materialId}-${activeModuleId}`}
          materialId={materialId}
          moduleId={activeModuleId}
          quizOpen={quizOpen}
          courseId={courseId}
          studyHrefBase={studyBase}
          learnMode={learnMode}
          docked
        />
      </div>

      {/* Ask Rose + Refine sit together at the bottom of the dock. */}
      <div className="flex flex-col items-end gap-2">
        {courseManageEnabled ? (
          <CourseRefineDrawer
            materialId={materialId}
            preferModuleId={activeModuleId}
            docked
            showLauncher={false}
            open={refineOpen}
            onOpenChange={(next) => {
              setRefineOpen(next);
              if (next) setAskRoseOpen(false);
            }}
            onSwitchToAsk={() => {
              setRefineOpen(false);
              setAskRoseOpen(true);
            }}
          />
        ) : null}
        <StudyChatDrawer
          materialId={materialId}
          moduleId={activeModuleId}
          quizOpen={quizOpen}
          courseId={courseId}
          studyHrefBase={studyBase}
          learnMode={learnMode}
          docked
          open={askRoseOpen}
          onOpenChange={(next) => {
            setAskRoseOpen(next);
            if (next) setRefineOpen(false);
          }}
          canRefine={courseManageEnabled}
          refineBusy={refineApplying}
          onSwitchToRefine={() => {
            setAskRoseOpen(false);
            setRefineOpen(true);
          }}
        />
      </div>
    </div>

    {mode === "quiz" ? (
      <>
        <PracticeProgressPullTab
          open={progressPanelOpen}
          onOpenChange={(next) => {
            setProgressPanelOpen(next);
            if (next && alignProgressWithProfile) router.refresh();
          }}
          courseTitle={
            alignProgressWithProfile && workspaceCourseTitle
              ? workspaceCourseTitle
              : course.title
          }
          sourceLabel={sourceLabel}
          completedCount={pullProgressCompleted}
          totalModules={pullProgressTotal}
          progressPct={pullProgressPct}
          masteryPct={pullMasteryPct}
          panelEyebrow={alignProgressWithProfile ? t.study.thisCourse : undefined}
          modulesDetailLine={
            alignProgressWithProfile && practiceProgressCourseSummary
              ? tf(
                  practiceProgressCourseSummary.uploadsCount === 1
                    ? t.study.modulesDetailLineOne
                    : t.study.modulesDetailLine,
                  {
                    completed: practiceProgressCourseSummary.modulesCompleted,
                    total: practiceProgressCourseSummary.modulesTotal,
                    count: practiceProgressCourseSummary.uploadsCount,
                  }
                )
              : undefined
          }
          quizMetricSource={
            alignProgressWithProfile ? "profileCourse" : "materialBank"
          }
        />
      </>
    ) : null}
    </>
  );
}
