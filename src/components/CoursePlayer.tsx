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
} from "react";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { CourseModeToggle } from "@/components/CourseModeToggle";
import { LessonEditableBlocks } from "@/components/LessonEditableBlocks";
import { LessonNotesCapture } from "@/components/LessonNotesCapture";
import { ModuleQuizReview } from "@/components/ModuleQuizReview";
import { PersonalQuizSection } from "@/components/PersonalQuizSection";
import { SrsReviewLauncher } from "@/components/SrsReviewLauncher";
import { useSrsDueCounts } from "@/lib/srs-due";
import { useCourseMode } from "@/lib/mentored/use-course-mode";
import { persistStudyModulePosition } from "@/lib/study/persist-study-module";
import { CourseRefineDrawer } from "@/components/CourseRefineDrawer";
import { PracticeProgressPullTab } from "@/components/PracticeProgressPullTab";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import { VoiceTutorDock } from "@/components/VoiceTutorDock";
import {
  AROSES_COURSE_REFINED_EVENT,
  type ArosesCourseRefinedDetail,
} from "@/lib/refine-course-events";
import type {
  CourseModule,
  CoursePayload,
  CourseQuizItem,
  SidebarMaterialOutline,
} from "@/types/course";
import type { QuizReviewStatsDto } from "@/types/quiz-review";
import type { CourseLearningSummary } from "@/lib/learning-stats";

const EMPTY_MODULE_QUIZ: CourseQuizItem[] = [];

function ModuleLessonJumpNav({
  lessons,
  onJump,
}: {
  lessons: { title: string }[];
  onJump: (lessonIndex: number) => void;
}) {
  if (lessons.length <= 1) return null;
  return (
    <div className="mb-2 ml-2 mt-1 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Lessons
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
  course,
  courseId,
  materialId,
  sourceLabel,
  initialCompletedModuleIds,
  sidebarOutlines,
  initialModuleFromUrl,
  mode = "lessons",
  studyHrefBase,
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
  /** `lessons` = lecture only + link to practice page. `quiz` = review + quiz (no lesson body). */
  mode?: "lessons" | "quiz";
  /** Defaults to dashboard study URL; use `/explore/[courseId]/study` for public learners. */
  studyHrefBase?: string;
  /** When false, hide editing, AI refine, and generating more quiz questions (Explore). */
  courseManageEnabled?: boolean;
  /** When true, keep `mode=learn` on lecture/practice URLs (dashboard “study as learner”). */
  learnMode?: boolean;
  /** Workspace title from DB — used in progress drawer when syncing to Profile metrics. */
  workspaceCourseTitle?: string | null;
  /** When set (dashboard quiz), progress drawer matches Profile → Progress for this course. */
  practiceProgressCourseSummary?: CourseLearningSummary | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studyBase =
    studyHrefBase ?? `/dashboard/courses/${courseId}/study`;
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
    pickInitialModuleId(course, initialModuleFromUrl)
  );
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
  const [refineApplyFlash, setRefineApplyFlash] = useState(false);
  const refineClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    setRefineApplyFlash(false);
    if (refineClearTimerRef.current) {
      clearTimeout(refineClearTimerRef.current);
      refineClearTimerRef.current = null;
    }
  }, [materialId]);

  useEffect(() => {
    function onRefined(ev: Event) {
      const d = (ev as CustomEvent<ArosesCourseRefinedDetail>).detail;
      if (!d || d.materialId !== materialId) return;
      setRefineApplyFlash(true);
      router.refresh();
      if (refineClearTimerRef.current) clearTimeout(refineClearTimerRef.current);
      refineClearTimerRef.current = setTimeout(() => {
        setRefineApplyFlash(false);
        refineClearTimerRef.current = null;
      }, 2200);
    }
    window.addEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
    return () => {
      window.removeEventListener(AROSES_COURSE_REFINED_EVENT, onRefined);
      if (refineClearTimerRef.current) {
        clearTimeout(refineClearTimerRef.current);
        refineClearTimerRef.current = null;
      }
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
    (lessonIndex: number) => {
      const mod = course.modules.find((m) => m.id === activeModuleId);
      if (!mod) return;
      document
        .getElementById(`lesson-${mod.id}-${lessonIndex}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [course.modules, activeModuleId]
  );

  useEffect(() => {
    setLessonJumpVal("");
  }, [activeModuleId, materialId]);

  useEffect(() => {
    persistStudyModulePosition(materialId, activeModuleId);
  }, [materialId, activeModuleId]);

  useEffect(() => {
    if (mode !== "quiz" || practiceTab !== "module" || !activeModule) {
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

  // Live due-count for this material so the Start button can advertise
  // pending review work.
  const { counts: dueCounts } = useSrsDueCounts(materialId, {
    enabled: mode === "quiz",
    refreshKey: reviewRefreshEpoch,
  });

  // Mentored Learning vs. Free Exploration toggle (Phase 1 of the
  // Mentored Learning rollout). New courses default to Mentored.
  const { mode: courseMode, setMode: setCourseMode } =
    useCourseMode(materialId);
  const dueForThisMaterial =
    dueCounts?.byMaterial.find((m) => m.materialId === materialId) ??
    (dueCounts ? { module: 0, personal: 0, total: 0 } : null);

  const moduleQuizPageHref = useMemo(
    () =>
      `${studyBase}/quiz?${buildStudySearchParams(materialId, activeModuleId, learnMode)}`,
    [studyBase, materialId, activeModuleId, learnMode]
  );

  const focusQuizPageHref = useMemo(
    () =>
      `${studyBase}/quiz?${buildStudySearchParams(materialId, activeModuleId, learnMode, "focus")}`,
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
        window.scrollTo(0, 0);
      }
      persistStudyModulePosition(materialId, modId);
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
            : "Could not generate new questions."
        );
        return;
      }
      router.refresh();
    } catch {
      setQuizAppendError("Network error.");
    } finally {
      setQuizAppendBusy(false);
    }
  }, [activeModule, courseManageEnabled, materialId, router]);

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
    const res = await fetch("/api/complete-module", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialId, moduleId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "Could not save module progress"
      );
    }
    setCompleted((prev) => new Set([...prev, moduleId]));
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

  function beginRename(mod: CourseModule) {
    setManageError(null);
    setRenamingModuleId(mod.id);
    setRenameDraft(mod.title);
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
      setManageError("Title must be 1–200 characters.");
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
          typeof body.error === "string" ? body.error : "Could not rename."
        );
        setBusyModuleId(null);
        return;
      }
      setRenamingModuleId(null);
      router.refresh();
    } catch {
      setManageError("Network error.");
    }
    setBusyModuleId(null);
  }

  async function deleteModule(modId: number) {
    if (course.modules.length <= 1) return;

    const ok = window.confirm(
      "Delete this module? Remaining modules will be renumbered. Progress and quiz attempts for this upload will be reset."
    );
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
          typeof body.error === "string" ? body.error : "Could not delete."
        );
        setBusyModuleId(null);
        return;
      }
      setRenamingModuleId(null);
      router.refresh();
    } catch {
      setManageError("Network error.");
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
      <p className="text-sm text-zinc-500">No modules in this course.</p>
    );
  }

  return (
    <>
      {refineApplyFlash && courseManageEnabled ? (
        <div className="border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Updating study content
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Merging your edits into this page…
            </p>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="absolute inset-y-0 w-[28%] rounded-full bg-brand/90 dark:bg-brand-soft animate-course-upload-indeterminate"
                aria-hidden
              />
            </div>
          </div>
        </div>
      ) : null}
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      <aside className="border-b border-zinc-200/90 bg-gradient-to-b from-zinc-50 to-white lg:w-[22rem] lg:shrink-0 lg:border-r lg:border-b-0 dark:border-zinc-800 dark:from-zinc-950 dark:to-zinc-950">
        <div className="sticky top-16 space-y-6 p-6 lg:top-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
              {courseManageEnabled ? "Your course" : "Course"}
            </p>
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
                    {descriptionExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <span>This upload</span>
              <span>{completedCount}/{totalModules} modules</span>
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
                Whole-course mixed quiz
              </Link>
            ) : null}
          </div>

          <nav className="space-y-3">
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {showAccordion ? "All materials" : "Curriculum"}
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
                    const name = o.examGroupName ?? (o.examGroupId ? "Section" : "Other");
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
                              viewing
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
                                  Module title
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
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={cancelRename}
                                    className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                  >
                                    Cancel
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
                                      {mod.title}
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
                                        Rename
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
                                        Delete
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
                              <span className="leading-snug">{mod.title}</span>
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
                          Module title
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
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={cancelRename}
                            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            Cancel
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
                          <span className="leading-snug">{mod.title}</span>
                        </button>
                        {courseManageEnabled ? (
                          <div className="flex shrink-0 flex-col justify-center gap-0.5 py-1 pr-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => beginRename(mod)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-brand-blush hover:text-brand disabled:opacity-40 dark:hover:bg-[#1e1616]/50 dark:hover:text-brand-soft"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={busy || course.modules.length <= 1}
                              onClick={() => void deleteModule(mod.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40 dark:text-red-400"
                            >
                              Delete
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
            Source file:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-400">
              {sourceLabel}
            </span>
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10">
          <AiStudyDisclaimer className="mb-6 sm:mb-8" />
          {mode === "lessons" ? (
            <>
              <CourseModeToggle
                mode={courseMode}
                onChange={(next) => {
                  // Mentored Learning lives in the dedicated immersive route
                  // now — switching here just navigates there and lets that
                  // page persist the mode + run onboarding/lesson.
                  if (next === "mentored") {
                    setCourseMode("mentored");
                    const qs = new URLSearchParams();
                    qs.set("material", materialId);
                    qs.set("module", String(activeModule.id));
                    router.push(
                      `/dashboard/courses/${courseId}/learn?${qs.toString()}`
                    );
                  } else {
                    setCourseMode("free");
                  }
                }}
                hint="Mentored Learning opens in a focused tutoring view; Free Exploration is the reading mode you're in now."
              />
              <header className="border-b border-zinc-100 pb-8 dark:border-zinc-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  Module {activeModule.id}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {activeModule.title}
                </h2>
              </header>

              {activeModule.lessons.length > 1 ? (
                <div className="mt-6 lg:hidden">
                  <label
                    htmlFor="lesson-jump-select"
                    className="sr-only"
                  >
                    Jump to lesson
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
                    <option value="">Jump to lesson…</option>
                    {activeModule.lessons.map((lesson, li) => (
                      <option key={li} value={String(li)}>
                        {li + 1}. {lesson.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="mt-10 space-y-14">
                {activeModule.lessons.map((lesson, li) => (
                  <div
                    key={li}
                    id={`lesson-${activeModule.id}-${li}`}
                    className="scroll-mt-24"
                  >
                    <LessonEditableBlocks
                      materialId={materialId}
                      moduleId={activeModule.id}
                      lessonIndex={li}
                      lesson={lesson}
                      readOnly={!courseManageEnabled}
                    />
                    <LessonNotesCapture
                      materialId={materialId}
                      moduleId={activeModule.id}
                      lessonIndex={li}
                      lessonTitle={lesson.title}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-14 rounded-2xl border border-brand-border bg-gradient-to-br from-brand-blush/90 to-white p-6 shadow-sm dark:border-brand-border/40 dark:from-[#1e1616]/40 dark:to-zinc-950">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Practice & review
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Jump to practice with either tab below—the lecture page stays
                  uncluttered.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={moduleQuizPageHref}
                    className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                  >
                    Module quiz
                  </Link>
                  <Link
                    href={focusQuizPageHref}
                    className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Focus quiz
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <>
              <header className="border-b border-zinc-100 pb-5 dark:border-zinc-900">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                    Module {activeModule.id}
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {activeModule.title}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Switch with the tabs below —{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Module quiz
                    </span>{" "}
                    is the shared bank;{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Focus quiz
                    </span>{" "}
                    is your private cards from notes.
                  </p>
                </div>
                <div
                  className="mt-5 flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="Practice type"
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
                    <span>Module quiz</span>
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
                    <span>Focus quiz</span>
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
                          Module bank review
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                          Shared questions for this module (same pool as the quiz
                          below). Focus cards stay under the Focus quiz tab.
                        </p>
                      </div>
                      <div className="p-3 sm:p-4">
                        {moduleQuizBank.length === 0 ? (
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            No module bank questions for this module yet.
                            {courseManageEnabled
                              ? " Generate a batch under Module quiz below."
                              : ""}
                          </p>
                        ) : (
                          <ModuleQuizReview
                            showHeader={false}
                            compact
                            embedded
                            bankScopeHint={`Module ${activeModule.id} · Module quiz bank`}
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
                      Module quiz
                    </h3>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      Uses the shared module bank only. For cards from your notes,
                      open the{" "}
                      <button
                        type="button"
                        onClick={() => selectPracticeTab("focus")}
                        className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
                      >
                        Focus quiz
                      </button>{" "}
                      tab.
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
                              ? "Generating questions…"
                              : "Generate more questions (AI)"}
                          </button>
                          {moduleQuizBank.length > 0 ? (
                            <span className="text-xs text-zinc-500">
                              Bank: {moduleQuizBank.length} question
                              {moduleQuizBank.length === 1 ? "" : "s"} in this
                              module
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
                              No questions yet — generate a batch to start the quiz.
                            </span>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Question bank is managed by the course creator.
                          {moduleQuizBank.length > 0 ? (
                            <>
                              {" "}
                              Bank: {moduleQuizBank.length} question
                              {moduleQuizBank.length === 1 ? "" : "s"}.
                            </>
                          ) : (
                            <> No questions in this module yet.</>
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
                          Review queue — {missedQuizIndices.length} question
                          {missedQuizIndices.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                          Still weak on your last try — they&apos;ll appear first in
                          your next quiz until you answer them correctly.
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
                            +{missedQuizIndices.length - 5} more in this module
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {!quizOpen ? (
                      <button
                        type="button"
                        disabled={
                          moduleQuizBank.length === 0 || personalQuizActive
                        }
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
                          moduleQuizBank.length === 0
                            ? "Generate questions first"
                            : personalQuizActive
                              ? "Finish your focus quiz first"
                              : undefined
                        }
                        className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
                      >
                        {dueForThisMaterial && dueForThisMaterial.module > 0
                          ? `Review ${dueForThisMaterial.module} due card${dueForThisMaterial.module === 1 ? "" : "s"}`
                          : "Start module review"}
                        {dueForThisMaterial && dueForThisMaterial.module > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold tabular-nums">
                            {dueForThisMaterial.module}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <div
                        id="module-quiz-run"
                        className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50/50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/30 sm:p-7"
                      >
                        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200/80 pb-5 dark:border-zinc-800">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
                              Module quiz run
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
                            ← Back to overview
                          </button>
                        </div>
                        <SrsReviewLauncher
                          key={`${activeModule.id}-${quizSessionEpoch}`}
                          scope="module"
                          materialId={materialId}
                          moduleId={activeModule.id}
                          sessionKey={`module-${materialId}-${activeModule.id}`}
                          heading="Module review"
                          onExit={() => {
                            setQuizOpen(false);
                            bumpReviewRefresh();
                          }}
                          onComplete={() => {
                            // Fire-and-forget: refresh review/progress state,
                            // and mark the module complete if the learner
                            // finished the deck. The SRS card scheduling has
                            // already happened on the server.
                            bumpReviewRefresh();
                            handleQuizPassFinished?.();
                            void completeModuleOnServer(activeModule.id, {
                              advanceToNextModule: false,
                            });
                          }}
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
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {courseManageEnabled ? (
        <CourseRefineDrawer materialId={materialId} docked />
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
      <StudyChatDrawer
        materialId={materialId}
        moduleId={activeModuleId}
        quizOpen={quizOpen}
        studyHrefBase={studyBase}
        learnMode={learnMode}
        docked
      />
    </div>

    {mode === "quiz" ? (
      <>
        <Link
          href={lecturePageHref}
          className="fixed left-4 top-[max(6.625rem,calc(env(safe-area-inset-top)+5.875rem))] z-[100] inline-flex items-center rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-lg shadow-black/12 ring-1 ring-black/5 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:shadow-black/35 dark:ring-white/10 dark:hover:bg-zinc-900 sm:top-[max(7.375rem,calc(env(safe-area-inset-top)+6.625rem))] lg:left-[calc(22rem+1rem)]"
        >
          ← Lecture
        </Link>
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
          panelEyebrow={alignProgressWithProfile ? "This course" : undefined}
          modulesDetailLine={
            alignProgressWithProfile && practiceProgressCourseSummary
              ? `${practiceProgressCourseSummary.modulesCompleted}/${practiceProgressCourseSummary.modulesTotal} modules · ${practiceProgressCourseSummary.uploadsCount} ${practiceProgressCourseSummary.uploadsCount === 1 ? "material" : "materials"} · matches Profile → Progress`
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
