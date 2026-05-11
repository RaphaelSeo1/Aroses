"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AiStudyDisclaimer } from "@/components/AiStudyDisclaimer";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { LessonEditableBlocks } from "@/components/LessonEditableBlocks";
import { TypewriterText } from "@/components/TypewriterText";
import {
  pollPdfIngestJob,
  type PdfBuildProgressUI,
} from "@/lib/pdf-ingest-client";
import type { CoursePayload } from "@/types/course";

type RowState = {
  label: string;
  line: string;
  bar: PdfBuildProgressUI["bar"];
  error?: string;
  materialId?: string;
};

export function CourseBuildTheater({
  courseId,
  jobIds,
  sectionId,
}: {
  courseId: string;
  jobIds: string[];
  sectionId?: string | null;
}) {
  const router = useRouter();
  const [activeJob, setActiveJob] = useState(jobIds[0] ?? "");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [previewByJob, setPreviewByJob] = useState<
    Record<string, CoursePayload | null>
  >({});
  const [phase, setPhase] = useState<"boot" | "running" | "done">("boot");
  const [summary, setSummary] = useState<"success" | "partial" | "fail" | null>(
    null
  );
  const [moduleIdx, setModuleIdx] = useState(0);

  const courseHome = `/dashboard/courses/${courseId}`;
  const courseHomeWithSection =
    sectionId && sectionId.length > 0
      ? `${courseHome}?section=${encodeURIComponent(sectionId)}`
      : courseHome;

  const goToStudyEditor = useCallback(
    (materialId: string) => {
      const u = `/dashboard/courses/${courseId}/study?material=${encodeURIComponent(materialId)}`;
      router.replace(u);
      router.refresh();
    },
    [router, courseId]
  );

  const goToCourseWorkspace = useCallback(() => {
    router.replace(courseHomeWithSection);
    router.refresh();
  }, [router, courseHomeWithSection]);

  useEffect(() => {
    if (jobIds.length === 0) return;

    const ac = new AbortController();
    let successTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      const labelMap: Record<string, string> = {};
      await Promise.all(
        jobIds.map(async (id) => {
          try {
            const r = await fetch(`/api/process-pdf/jobs/${id}`, {
              signal: ac.signal,
            });
            const raw = await r.text();
            const j = JSON.parse(raw) as { originalFileName?: string };
            labelMap[id] =
              typeof j.originalFileName === "string" &&
              j.originalFileName.trim()
                ? j.originalFileName.trim()
                : "PDF";
          } catch {
            if (!ac.signal.aborted) labelMap[id] = "PDF";
          }
        })
      );
      if (ac.signal.aborted) return;

      setRows(
        Object.fromEntries(
          jobIds.map((id) => [
            id,
            {
              label: labelMap[id] ?? "PDF",
              line: "Starting…",
              bar: "indeterminate" as const,
            },
          ])
        )
      );
      setPhase("running");

      const outcomes = await Promise.all(
        jobIds.map(async (id) => {
          const polled = await pollPdfIngestJob(
            id,
            (info) => {
              if (ac.signal.aborted) return;
              setRows((prev) => ({
                ...prev,
                [id]: {
                  label: prev[id]?.label ?? labelMap[id] ?? "PDF",
                  line: info.line,
                  bar: info.bar,
                },
              }));
            },
            {
              signal: ac.signal,
              onPreviewCourse: (course) => {
                if (ac.signal.aborted) return;
                setPreviewByJob((prev) => ({ ...prev, [id]: course }));
              },
            }
          );
          return { id, polled };
        })
      );

      if (ac.signal.aborted) return;

      setRows((prev) => {
        const next = { ...prev };
        for (const { id, polled } of outcomes) {
          const base = next[id] ?? {
            label: "PDF",
            line: "",
            bar: null as PdfBuildProgressUI["bar"],
          };
          next[id] = {
            ...base,
            error: polled.error,
            materialId: polled.materialId,
            line: polled.error
              ? polled.error
              : polled.materialId
                ? "Ready — open study mode below."
                : base.line,
            bar: polled.materialId ? 100 : base.bar,
          };
        }
        return next;
      });

      const okCount = outcomes.filter((o) => o.polled.materialId).length;
      const errCount = outcomes.filter((o) => o.polled.error).length;
      const s: "success" | "partial" | "fail" =
        errCount === 0 ? "success" : okCount > 0 ? "partial" : "fail";
      setSummary(s);
      setPhase("done");

      const firstMaterialInOrder = jobIds
        .map((id) => outcomes.find((o) => o.id === id)?.polled.materialId)
        .find((m) => typeof m === "string" && m.length > 0);

      if (s === "success" && firstMaterialInOrder) {
        successTimer = setTimeout(() => {
          goToStudyEditor(firstMaterialInOrder);
        }, 12_000);
      }
    };

    void run();

    return () => {
      ac.abort();
      if (successTimer) clearTimeout(successTimer);
    };
  }, [jobIds.join(","), goToStudyEditor]);

  useEffect(() => {
    const p = previewByJob[activeJob]?.modules;
    if (p && moduleIdx >= p.length) setModuleIdx(Math.max(0, p.length - 1));
  }, [previewByJob, activeJob, moduleIdx]);

  if (jobIds.length === 0) return null;

  const preview = previewByJob[activeJob];
  const row = rows[activeJob];
  const firstMaterialId = jobIds
    .map((id) => rows[id]?.materialId)
    .find((m) => typeof m === "string" && m.length > 0);
  const mod = preview?.modules[moduleIdx];

  return (
    <>
      <AppHeader
        right={
          <HeaderNavLoggedIn courseHomeHref={courseHomeWithSection} />
        }
      />
      <main className="min-h-[calc(100vh-4rem)] bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-10">
          <nav className="mb-6 text-sm">
            <Link
              href={courseHomeWithSection}
              className="font-medium text-brand hover:underline dark:text-brand-soft"
            >
              ← Back to course
            </Link>
          </nav>

          <AiStudyDisclaimer className="mb-6" />

          {jobIds.length > 1 ? (
            <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              {jobIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveJob(id);
                    setModuleIdx(0);
                  }}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    id === activeJob
                      ? "bg-brand text-white dark:bg-brand"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {rows[id]?.label ?? "PDF"}
                </button>
              ))}
            </div>
          ) : null}

          {row ? (
            <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                {row.label}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-200">
                {row.line}
              </p>
              <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                {row.bar === "indeterminate" ? (
                  <div
                    className="absolute inset-y-0 w-[28%] rounded-full bg-brand/90 dark:bg-brand-soft animate-course-upload-indeterminate"
                    aria-hidden
                  />
                ) : typeof row.bar === "number" ? (
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-300 dark:bg-brand-soft"
                    style={{
                      width: `${Math.max(2, Math.min(100, row.bar))}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {!preview ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Blank page — your course will fill in here as soon as the outline
                is ready.
              </p>
              <p className="mt-2 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
                Titles, lessons, key terms, and examples appear in the same layout
                as study mode, updated as each part finishes generating.
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              <header className="border-b border-zinc-100 pb-8 dark:border-zinc-900">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  <TypewriterText
                    text={preview.title}
                    instantBelow={0}
                    charDelayMs={42}
                    charsPerTick={1}
                  />
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <TypewriterText
                    text={preview.description}
                    mode="words"
                    wordDelayMs={48}
                    instantBelow={0}
                  />
                </p>
              </header>

              {preview.modules.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {preview.modules.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModuleIdx(i)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        i === moduleIdx
                          ? "bg-brand text-white dark:bg-brand"
                          : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      {m.title}
                    </button>
                  ))}
                </div>
              ) : null}

              {mod ? (
                <section className="space-y-10">
                  <header className="border-b border-zinc-100 pb-6 dark:border-zinc-900">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                      Module {mod.id}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      <TypewriterText
                        text={mod.title}
                        instantBelow={0}
                        charDelayMs={42}
                        charsPerTick={1}
                      />
                    </h2>
                  </header>

                  <div className="space-y-14">
                    {mod.lessons.map((lesson, li) => (
                      <div key={`${mod.id}-${li}`} className="scroll-mt-24">
                        <LessonEditableBlocks
                          materialId="__live_build__"
                          moduleId={mod.id}
                          lessonIndex={li}
                          lesson={lesson}
                          readOnly
                          animateReveal
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}

          {phase === "done" && summary === "success" && typeof firstMaterialId === "string" ? (
            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-8 dark:border-zinc-800">
              <Link
                href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(firstMaterialId)}`}
                className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
              >
                Open in editor
              </Link>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Opening the study editor in a few seconds (you can use the button
                now)…
              </span>
            </div>
          ) : null}

          {phase === "done" && summary !== "success" ? (
            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-8 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => goToCourseWorkspace()}
                className="inline-flex rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {summary === "partial" ? "Dismiss & go to course" : "Dismiss"}
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
