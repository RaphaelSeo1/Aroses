"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { LessonEditableBlocks } from "@/components/LessonEditableBlocks";
import { LessonNotesCapture } from "@/components/LessonNotesCapture";
import { ModuleQuiz } from "@/components/ModuleQuiz";
import { ModuleQuizReview } from "@/components/ModuleQuizReview";
import { PersonalQuizSection } from "@/components/PersonalQuizSection";
import { buildQuizSessionItems } from "@/lib/quiz-session";
import { CourseRefineDrawer } from "@/components/CourseRefineDrawer";
import { StudyChatDrawer } from "@/components/StudyChatDrawer";
import type {
  CourseModule,
  CoursePayload,
  CourseQuizItem,
  SidebarMaterialOutline,
} from "@/types/course";
import type { QuizReviewStatsDto } from "@/types/quiz-review";

const EMPTY_MODULE_QUIZ: CourseQuizItem[] = [];

function buildStudySearchParams(
  materialId: string,
  moduleId: number,
  learnMode: boolean
): string {
  const p = new URLSearchParams();
  p.set("material", materialId);
  p.set("module", String(moduleId));
  if (learnMode) p.set("mode", "learn");
  return p.toString();
}

function pickInitialModuleId(
  course: CoursePayload,
  urlModule?: number
): number {
  const first = course.modules[0]?.id ?? 1;
  if (
    urlModule != null &&
    course.modules.some((m) => m.id === urlModule)
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
}) {
  const router = useRouter();
  const studyBase =
    studyHrefBase ?? `/dashboard/courses/${courseId}/study`;
  const navigationBasePath =
    mode === "quiz" ? `${studyBase}/quiz` : studyBase;
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

  useEffect(() => {
    if (mode !== "quiz" || !activeModule) return;
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
  }, [mode, materialId, activeModule?.id, quizOpen]);

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
  }, [mode, materialId, activeModule?.id, quizOpen]);

  const moduleQuizBank = activeModule?.quiz ?? EMPTY_MODULE_QUIZ;

  const quizSessionItems = useMemo(
    () =>
      mode === "quiz" && activeModule
        ? buildQuizSessionItems(
            moduleQuizBank,
            missedQuizIndices,
            quizSessionEpoch
          )
        : [],
    [mode, activeModule, moduleQuizBank, missedQuizIndices, quizSessionEpoch]
  );

  const practicePageHref = useMemo(
    () =>
      `${studyBase}/quiz?${buildStudySearchParams(materialId, activeModuleId, learnMode)}`,
    [studyBase, materialId, activeModuleId, learnMode]
  );

  const lecturePageHref = useMemo(
    () =>
      `${studyBase}?${buildStudySearchParams(materialId, activeModuleId, learnMode)}`,
    [studyBase, materialId, activeModuleId, learnMode]
  );

  /** Keeps `module=` in the URL when switching modules (study vs quiz routes). */
  const syncModuleToUrl = useCallback(
    (modId: number) => {
      setActiveModuleId(modId);
      setQuizOpen(false);
      const q = `?${buildStudySearchParams(materialId, modId, learnMode)}`;
      router.replace(`${navigationBasePath}${q}`, { scroll: false });
    },
    [materialId, navigationBasePath, router, learnMode]
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

  const totalModules = course.modules.length;
  const completedCount = completed.size;
  const progressPct =
    totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;

  const completeModuleOnServer = useCallback(
    async (
      moduleId: number,
      options?: { advanceToNextModule?: boolean }
    ) => {
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
      setQuizOpen(false);
      if (options?.advanceToNextModule) {
        const ix = course.modules.findIndex((m) => m.id === moduleId);
        const nextMod = ix >= 0 ? course.modules[ix + 1] : undefined;
        if (nextMod) {
          syncModuleToUrl(nextMod.id);
        }
      }
    },
    [materialId, course.modules, syncModuleToUrl]
  );

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
      setQuizOpen(false);
      setRenamingModuleId(null);
      const q = `?${buildStudySearchParams(targetMaterialId, modId, learnMode)}`;
      if (targetMaterialId === materialId) {
        setActiveModuleId(modId);
        router.replace(`${navigationBasePath}${q}`, { scroll: false });
      } else {
        router.push(`${navigationBasePath}${q}`);
      }
    },
    [materialId, navigationBasePath, router, learnMode]
  );

  const showAccordion = sidebarOutlines.length > 0;

  const outlinesKey = sidebarOutlines.map((o) => o.materialId).join(",");
  const [expandedBuildIds, setExpandedBuildIds] = useState<Set<string>>(
    () => new Set(sidebarOutlines.map((o) => o.materialId))
  );

  useEffect(() => {
    setExpandedBuildIds(new Set(sidebarOutlines.map((o) => o.materialId)));
  }, [outlinesKey]);

  function toggleBuildSection(buildId: string) {
    setExpandedBuildIds((prev) => {
      const next = new Set(prev);
      if (next.has(buildId)) next.delete(buildId);
      else next.add(buildId);
      return next;
    });
  }

  if (!activeModule) {
    return (
      <p className="text-sm text-zinc-500">No modules in this course.</p>
    );
  }

  return (
    <>
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
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {course.description}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <span>Course progress</span>
              <span>{completedCount}/{totalModules} modules</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-200/90 ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-hover transition-[width] duration-500 ease-out dark:from-brand dark:to-brand-hover"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <nav className="space-y-3">
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {showAccordion ? "All builds" : "Curriculum"}
            </p>
            {manageError && (
              <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {manageError}
              </p>
            )}
            {showAccordion
              ? sidebarOutlines.map((outline) => {
                  const doneCount = outline.completedModuleIds.length;
                  const totalM = outline.modules.length;
                  const isOpenBuild = outline.materialId === materialId;
                  const expanded = expandedBuildIds.has(outline.materialId);

                  return (
                    <div
                      key={outline.materialId}
                      className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/40"
                    >
                      <button
                        type="button"
                        onClick={() => toggleBuildSection(outline.materialId)}
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
                              <div
                                key={mod.id}
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
                })
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
                    <div
                      key={mod.id}
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
              <header className="border-b border-zinc-100 pb-8 dark:border-zinc-900">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  Module {activeModule.id}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {activeModule.title}
                </h2>
              </header>

              <div className="mt-10 space-y-14">
                {activeModule.lessons.map((lesson, li) => (
                  <div key={li}>
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
                  Multiple choice, short answers, attempt history, and the
                  question bank live on a dedicated page—so your lecture stays
                  readable and practice stays focused.
                </p>
                <Link
                  href={practicePageHref}
                  className="mt-5 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                >
                  Open practice room
                </Link>
              </div>
            </>
          ) : !quizOpen ? (
            <>
              <header className="border-b border-zinc-100 pb-5 dark:border-zinc-900">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                      Module {activeModule.id}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {activeModule.title}
                    </h2>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      Shared bank for everyone on this course — plus your own
                      focus questions from notes (below).
                    </p>
                  </div>
                  <Link
                    href={lecturePageHref}
                    className="shrink-0 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    ← Lecture
                  </Link>
                </div>
              </header>

              <ModuleQuizReview
                compact
                quiz={moduleQuizBank}
                reviewByIndex={reviewByIndex}
              />

              {activeModule ? (
                <PersonalQuizSection
                  materialId={materialId}
                  moduleId={activeModule.id}
                  blocked={quizOpen}
                  hasNextModule={hasNextModule}
                  onRunOpenChange={setPersonalQuizActive}
                  onAdvanceModule={() => {
                    const ix = course.modules.findIndex(
                      (m) => m.id === activeModule.id
                    );
                    const next = course.modules[ix + 1];
                    if (next) syncModuleToUrl(next.id);
                  }}
                />
              ) : null}

              <div className="mt-9 border-t border-zinc-100 pt-6 dark:border-zinc-900">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Module quiz
                </h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Each run shuffles questions and answer choices. You get a fresh
                  mix from the question bank (up to 14 per session); items you
                  missed recently are queued first, like spaced review. New
                  questions must be generated into this bank — they are not
                  invented on each click.
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
                <button
                  type="button"
                  disabled={moduleQuizBank.length === 0 || personalQuizActive}
                  onClick={() => {
                    setQuizSessionEpoch((e) => e + 1);
                    setQuizOpen(true);
                  }}
                  title={
                    moduleQuizBank.length === 0
                      ? "Generate questions first"
                      : personalQuizActive
                        ? "Finish your focus quiz first"
                        : undefined
                  }
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
                >
                  Start module quiz
                </button>
              </div>
            </>
          ) : (
            <div>
              <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-6 dark:border-zinc-900">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    {activeModule.title}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    Quiz
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setQuizOpen(false)}
                  className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  ← Back to review & setup
                </button>
              </div>

              <ModuleQuiz
                key={`${activeModule.id}-${quizSessionEpoch}`}
                materialId={materialId}
                moduleId={activeModule.id}
                items={quizSessionItems}
                shuffleEpoch={quizSessionEpoch}
                hasNextModule={hasNextModule}
                onCompleteQuiz={(choice) =>
                  completeModuleOnServer(activeModule.id, {
                    advanceToNextModule: choice === "next_module",
                  })
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {courseManageEnabled ? (
        <CourseRefineDrawer materialId={materialId} docked />
      ) : null}
      <StudyChatDrawer
        materialId={materialId}
        moduleId={activeModuleId}
        quizOpen={quizOpen}
        docked
      />
    </div>
    </>
  );
}
