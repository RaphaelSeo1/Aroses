"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import { LessonRichContent } from "@/components/LessonRichContent";
import type { BuildStage, BuildStatus, ModuleProgress } from "@/lib/course-build/status-view";
import { unwatchBuild, watchBuild } from "@/lib/course-build/watch";
import type { CourseModule, LessonVisualAsset } from "@/types/course";

const POLL_MS = 1200;
const POLL_HIDDEN_MS = 6000;
const TERMINAL = new Set(["complete", "failed", "canceled"]);

/**
 * Reveals text as it grows. New text types on from where the last version
 * stopped, fast enough to catch up before the next poll lands.
 */
function useTypedText(target: string, animate: boolean): string {
  const [shown, setShown] = useState("");
  const shownRef = useRef("");

  useEffect(() => {
    if (!animate) return;
    let cur = shownRef.current;
    if (!target.startsWith(cur)) {
      let i = 0;
      while (i < cur.length && i < target.length && cur[i] === target[i]) i++;
      cur = target.slice(0, i);
    }
    // A timer, not requestAnimationFrame: rAF stops in background tabs and
    // the text would never appear.
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const backlog = target.length - cur.length;
      if (backlog > 0) {
        const rate = Math.max(90, backlog / 1.1);
        const n = Math.max(1, Math.floor(((now - last) / 1000) * rate));
        cur = target.slice(0, cur.length + n);
      }
      last = now;
      shownRef.current = cur;
      setShown(cur);
      if (cur.length >= target.length) clearInterval(timer);
    }, 33);
    return () => {
      clearInterval(timer);
      shownRef.current = cur;
    };
  }, [target, animate]);

  return animate ? shown : target;
}

function Caret() {
  return <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-violet-500" />;
}

function Typed({ text, animate, caret = false }: { text: string; animate: boolean; caret?: boolean }) {
  const shown = useTypedText(text, animate);
  return (
    <>
      {shown}
      {caret && animate && shown.length < text.length ? <Caret /> : null}
    </>
  );
}

const MemoMarkdown = memo(function MemoMarkdown({
  markdown,
  figures,
}: {
  markdown: string;
  figures?: LessonVisualAsset[];
}) {
  return <LessonRichContent markdown={markdown} figures={figures} />;
});

/** Finished paragraphs render as markdown; the paragraph being written types out as plain text. */
function StreamingLesson({
  text,
  figures,
  animate,
  writing,
}: {
  text: string;
  figures?: LessonVisualAsset[];
  animate: boolean;
  writing: boolean;
}) {
  const shown = useTypedText(text, animate);
  const typing = writing || shown.length < text.length;
  if (!typing) return <MemoMarkdown markdown={shown} figures={figures} />;
  const cut = shown.lastIndexOf("\n\n");
  const head = cut > 0 ? shown.slice(0, cut) : "";
  const tail = cut > 0 ? shown.slice(cut + 2) : shown;
  return (
    <div>
      {head.trim() ? <MemoMarkdown markdown={head} /> : null}
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        {tail}
        <Caret />
      </p>
    </div>
  );
}

const STAGES: Array<{ key: BuildStage; label: string }> = [
  { key: "reading", label: "Reading your files" },
  { key: "planning", label: "Planning the course" },
  { key: "figures", label: "Finding figures" },
  { key: "writing", label: "Writing modules" },
  { key: "done", label: "Done" },
];

function stageIndex(stages: typeof STAGES, stage: BuildStage): number {
  const i = stages.findIndex((s) => s.key === (stage === "finishing" ? "writing" : stage));
  return i < 0 ? 0 : i;
}

function Stepper({ status }: { status: BuildStatus }) {
  const stopped = status.stage === "failed" || status.stage === "canceled";
  const stages = status.figures ? STAGES : STAGES.filter((s) => s.key !== "figures");
  const reached: BuildStage = status.plan
    ? status.figures && !status.figures.done
      ? "figures"
      : "writing"
    : status.sourcePages > 0
      ? "planning"
      : "reading";
  const current = stageIndex(stages, stopped ? reached : status.stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {stages.map((s, i) => {
        const done = status.stage === "done" || i < current || (s.key === "figures" && !!status.figures?.done);
        const active = !done && !stopped && i === current;
        const label =
          s.key === "writing" && status.modulesTotal > 0
            ? `Writing modules (${status.modulesDone} of ${status.modulesTotal} done)`
            : s.key === "writing" && status.stage === "finishing"
              ? "Finishing up"
              : s.key === "figures" && status.figures?.done
                ? status.figures.found === 1
                  ? "1 figure found"
                  : `${status.figures.found || "No"} figures found`
                : s.label;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={`flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${
                done
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : active
                    ? "bg-violet-600 text-white shadow-sm shadow-violet-600/30"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {done ? "✓" : active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : null}
              {label}
            </span>
            {i < stages.length - 1 ? <span className="text-zinc-300 dark:text-zinc-700">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

const BADGE: Record<ModuleProgress["status"], { text: string; cls: string }> = {
  waiting: { text: "Waiting", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  writing: { text: "Writing…", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
  retrying: { text: "Retrying…", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
  done: { text: "Ready", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  failed: { text: "Failed", cls: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" },
};

function notifyDone(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted" || !document.hidden) return;
  try {
    new Notification(title, { body, icon: "/icon.png" });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

function BuildPanel({ buildId, courseId, onRetried }: { buildId: string; courseId: string; onRetried: (id: string) => void }) {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [modules, setModules] = useState<Record<number, CourseModule>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [canNotify, setCanNotify] = useState(
    () => typeof window !== "undefined" && "Notification" in window && Notification.permission === "default"
  );
  const haveRef = useRef<Set<number>>(new Set());
  const wasTerminalRef = useRef<boolean | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const have = [...haveRef.current].join(",");
        const res = await fetch(`/api/course-build/${buildId}${have ? `?have=${have}` : ""}`, { cache: "no-store" });
        if (res.status === 404) {
          setLoadError("This build doesn't exist or isn't yours.");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as BuildStatus;
        if (stopped) return;
        setLoadError(null);
        if (next.modules.length) {
          for (const m of next.modules) haveRef.current.add(m.id);
          setModules((prev) => ({ ...prev, ...Object.fromEntries(next.modules.map((m) => [m.id, m])) }));
        }
        if (next.status === "failed" || next.status === "canceled") {
          haveRef.current.clear();
          setModules({});
        }
        setStatus(next);
        const terminal = TERMINAL.has(next.status);
        if (wasTerminalRef.current === null) {
          setLive(!terminal);
          if (!terminal) watchBuild(buildId, courseId);
        } else if (!wasTerminalRef.current && terminal) {
          notifyDone(
            next.status === "complete" ? "Your course is ready" : "Your course build stopped",
            next.status === "complete" ? next.title || "Open Aroses to start studying." : next.error?.message || ""
          );
        }
        if (terminal) unwatchBuild(buildId);
        wasTerminalRef.current = terminal;
        if (terminal) return;
      } catch {
        if (!stopped) setLoadError("Reconnecting…");
      }
      if (!stopped) timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [buildId, courseId]);

  const autoModule = useMemo(() => {
    if (!status) return null;
    const writing = status.progress.find((p) => p.status === "writing" || p.status === "retrying");
    return writing?.id ?? status.progress.find((p) => p.status === "done")?.id ?? status.plan?.modules[0]?.id ?? null;
  }, [status]);
  const selected = picked ?? autoModule;

  const cancel = useCallback(async () => {
    const ok = await confirmDialog({
      title: "Cancel this build?",
      body: "Modules written so far are discarded and this build won't count against your plan.",
      confirmLabel: "Cancel build",
      cancelLabel: "Keep building",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusy(true);
    setActionError(null);
    const res = await fetch(`/api/course-build/${buildId}/cancel`, { method: "POST" }).catch(() => null);
    if (!res?.ok) setActionError("Couldn't cancel. Try again.");
    setActionBusy(false);
  }, [buildId]);

  const retry = useCallback(async () => {
    setActionBusy(true);
    setActionError(null);
    const res = await fetch(`/api/course-build/${buildId}/retry`, { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { buildId?: string; error?: string };
    setActionBusy(false);
    if (!res?.ok || !data.buildId) return setActionError(data?.error || "Couldn't start again. Try again in a moment.");
    watchBuild(data.buildId, courseId);
    onRetried(data.buildId);
  }, [buildId, courseId, onRetried]);

  if (!status) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
        {loadError ?? "Loading your build…"}
      </div>
    );
  }

  const animate = live === true;
  const running = !TERMINAL.has(status.status);
  const stopped = status.stage === "failed" || status.stage === "canceled";
  const planModules = status.plan?.modules ?? [];
  const progressById = new Map(status.progress.map((p) => [p.id, p]));
  const selectedPlan = planModules.find((m) => m.id === selected) ?? null;
  const selectedProgress = selected != null ? progressById.get(selected) : undefined;
  const selectedFinal = selected != null ? modules[selected] : undefined;
  const openHref = (moduleId?: number) =>
    status.materialId
      ? `/dashboard/courses/${courseId}/study?material=${status.materialId}${moduleId ? `&module=${moduleId}` : ""}`
      : null;

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
            {status.stage === "done"
              ? "Course ready"
              : status.stage === "failed"
                ? "Build failed"
                : status.stage === "canceled"
                  ? "Build canceled"
                  : status.canceling
                    ? "Canceling…"
                    : "Building your course"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {status.title ? (
              <Typed text={status.title} animate={animate} caret />
            ) : (
              <span className="text-zinc-400 dark:text-zinc-600">{status.sources.map((s) => s.label).join(" + ")}</span>
            )}
          </h1>
          {status.plan?.description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              <Typed text={status.plan.description} animate={animate} />
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.stage === "done" && openHref() ? (
            <Link
              href={openHref()!}
              className="rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 hover:from-violet-700 hover:to-fuchsia-700"
            >
              Start studying
            </Link>
          ) : null}
          {running && !status.canceling ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void cancel()}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          ) : null}
          {status.stage === "failed" || status.stage === "canceled" ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void retry()}
              className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {actionBusy ? "Starting…" : "Try again"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="mt-6">
        <Stepper status={status} />
      </div>

      {status.error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {status.error.message}
        </div>
      ) : null}
      {status.stage === "canceled" ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">This build was canceled and didn&apos;t count against your plan.</p>
      ) : null}
      {actionError ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
      {loadError && running ? <p className="mt-4 text-xs text-zinc-500">{loadError}</p> : null}

      {running && canNotify ? (
        <button
          type="button"
          onClick={() => void Notification.requestPermission().then(() => setCanNotify(false))}
          className="mt-4 text-xs font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
        >
          Notify me when it&apos;s done
        </button>
      ) : null}
      {running ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">You can close this tab. The build keeps going and will be in your course when it&apos;s done.</p>
      ) : null}

      {planModules.length === 0 && running ? (
        <div className="mt-8 space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {status.stage === "reading"
              ? `Reading ${status.sources.length === 1 ? status.sources[0].label : `${status.sources.length} files`}…`
              : `Planning modules from ${status.sourcePages} ${status.sourcePages === 1 ? "page" : "pages"}…`}
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-200/80 dark:bg-zinc-800/80" style={{ width: `${70 - i * 12}%` }} />
          ))}
        </div>
      ) : null}

      {planModules.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav className="space-y-2">
            {planModules.map((m) => {
              const p = progressById.get(m.id);
              const badge =
                stopped && p?.status !== "failed"
                  ? { text: "Not saved", cls: BADGE.waiting.cls }
                  : BADGE[p?.status ?? (status.stage === "done" ? "done" : "waiting")];
              const active = m.id === selected;
              const title = modules[m.id]?.title || m.title;
              const lessonTitles =
                m.lessons.length > 0
                  ? m.lessons
                  : (modules[m.id]?.lessons ?? p?.preview?.lessons ?? []).map((l) => l.title).filter(Boolean);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPicked(m.id)}
                  className={`block w-full rounded-xl border px-3.5 py-3 text-left transition ${
                    active
                      ? "border-violet-400 bg-violet-50/80 dark:border-violet-700 dark:bg-violet-950/30"
                      : "border-zinc-200 bg-white hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Module {m.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    <Typed text={title} animate={animate} />
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {lessonTitles.map((l, i) => (
                      <li key={i} className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        <Typed text={l} animate={animate} />
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </nav>

          <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white px-5 py-6 sm:px-8 dark:border-zinc-800 dark:bg-zinc-950/40">
            {selectedPlan ? (
              <ModuleView
                key={selectedPlan.id}
                planTitle={selectedPlan.title}
                moduleId={selectedPlan.id}
                progress={selectedProgress}
                final={stopped ? undefined : selectedFinal}
                stopped={stopped}
                animate={animate}
                openHref={openHref(selectedPlan.id)}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ModuleView({
  planTitle,
  moduleId,
  progress,
  final,
  stopped,
  animate,
  openHref,
}: {
  planTitle: string;
  moduleId: number;
  progress: ModuleProgress | undefined;
  final: CourseModule | undefined;
  stopped: boolean;
  animate: boolean;
  openHref: string | null;
}) {
  const writing = !final && (progress?.status === "writing" || progress?.status === "retrying");
  const lessons: Array<{ title: string; content: string; figures?: LessonVisualAsset[] }> = final
    ? final.lessons.map((l) => ({ title: l.title, content: l.content, figures: l.visual_assets }))
    : (progress?.preview?.lessons ?? []);
  const quizCount = final ? final.quiz.length : (progress?.preview?.quiz ?? 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Module {moduleId}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{final?.title || progress?.preview?.moduleTitle || planTitle}</h2>
        </div>
        {final && openHref ? (
          <Link
            href={openHref}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            Open module
          </Link>
        ) : null}
      </div>

      {lessons.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          {stopped
            ? "This build stopped, so nothing from it was saved to your course."
            : progress?.status === "retrying"
              ? "Taking another pass at this module…"
              : writing
                ? "Starting to write…"
                : "Waiting for its turn. Modules are written in parallel."}
        </p>
      ) : (
        <div className="mt-6 space-y-10">
          {lessons.map((l, i) => (
            <article key={i}>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <Typed text={l.title} animate={animate} />
              </h3>
              <div className="mt-2">
                <StreamingLesson
                  text={l.content}
                  figures={l.figures}
                  animate={animate}
                  writing={writing && i === lessons.length - 1}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {quizCount > 0 ? (
        <p className="mt-8 border-t border-zinc-100 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {final ? `Quiz · ${quizCount} questions` : `Writing the quiz · ${quizCount} ${quizCount === 1 ? "question" : "questions"} so far`}
        </p>
      ) : null}
    </div>
  );
}

export function CourseBuildLive({ courseId, courseTitle, buildIds }: { courseId: string; courseTitle: string; buildIds: string[] }) {
  const router = useRouter();
  const [ids, setIds] = useState(buildIds);
  const [active, setActive] = useState(buildIds[0]);

  const onRetried = useCallback(
    (newId: string) => {
      setIds((prev) => prev.map((id) => (id === active ? newId : id)));
      setActive(newId);
      const rest = ids.filter((id) => id !== active);
      router.replace(`/dashboard/courses/${courseId}/build/${newId}${rest.length ? `?also=${rest.join(",")}` : ""}`);
    },
    [active, courseId, ids, router]
  );

  return (
    <div>
      <Link href={`/dashboard/courses/${courseId}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← {courseTitle}
      </Link>
      {ids.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {ids.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${
                id === active
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              Material {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-6">
        <BuildPanel key={active} buildId={active} courseId={courseId} onRetried={onRetried} />
      </div>
    </div>
  );
}
