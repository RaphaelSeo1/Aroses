"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { EditableSection } from "@/components/EditableSection";
import { LessonMarkdownEditor } from "@/components/LessonMarkdownEditor";
import { LessonQuoteCaptureRegion } from "@/components/LessonQuoteCaptureRegion";
import { LessonSourceAttribution } from "@/components/LessonSourceAttribution";
import { LessonRichContent } from "@/components/LessonRichContent";
import { TypewriterText, useTypewriterString } from "@/components/TypewriterText";
import type { ArosesCourseRefinePreviewEdit } from "@/lib/refine-course-events";
import type { CourseLesson, KeyTerm } from "@/types/course";

function KeyTermReadOnlyCard({
  term,
  definition,
  animateReveal,
}: {
  term: string;
  definition: string;
  animateReveal: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <dt className="font-medium text-zinc-900 dark:text-zinc-100">
        {animateReveal ? (
          <TypewriterText
            text={term}
            instantBelow={0}
            charDelayMs={36}
            charsPerTick={1}
          />
        ) : (
          term
        )}
      </dt>
      <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {animateReveal ? (
          <TypewriterText
            text={definition}
            instantBelow={0}
            charDelayMs={11}
            charsPerTick={1}
          />
        ) : (
          definition
        )}
      </dd>
    </div>
  );
}

type Section = "title" | "body" | "key_terms" | "examples" | null;

/**
 * Pre-confirm preview: shows the current lesson text with a blinking caret and
 * a highlight over exactly the spans the pending edit will change — so the
 * student can see the edit is surgical (not a full rewrite) before confirming.
 */
function LessonEditPreview({
  content,
  spans,
}: {
  content: string;
  spans: { start: number; deleteLen: number; insert: string }[];
}) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let pos = 0;

  sorted.forEach((s, i) => {
    const start = Math.max(pos, Math.min(s.start, content.length));
    if (start > pos) {
      nodes.push(<span key={`t${i}`}>{content.slice(pos, start)}</span>);
    }
    // The caret hovering right where the edit begins.
    nodes.push(
      <span
        key={`c${i}`}
        className="mx-px inline-block h-[1.15em] w-0.5 animate-pulse bg-brand align-text-bottom dark:bg-brand-soft"
        aria-hidden
      />
    );
    if (s.deleteLen > 0) {
      const end = Math.min(start + s.deleteLen, content.length);
      const replacing = s.insert.length > 0;
      nodes.push(
        <mark
          key={`h${i}`}
          className={
            replacing
              ? "rounded-sm bg-amber-300/40 text-inherit dark:bg-amber-400/25"
              : "rounded-sm bg-red-300/40 text-inherit line-through decoration-red-500/60 dark:bg-red-500/25"
          }
        >
          {content.slice(start, end)}
        </mark>
      );
      pos = end;
    } else {
      // Pure insertion — mark the spot the new text will appear.
      nodes.push(
        <span
          key={`i${i}`}
          className="rounded-sm bg-emerald-300/40 px-0.5 text-[0.85em] font-semibold text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-300"
        >
          + add
        </span>
      );
      pos = start;
    }
  });
  nodes.push(<span key="tail">{content.slice(pos)}</span>);

  return (
    <div className="relative rounded-lg border border-brand/25 bg-brand-blush/30 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/40">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
        </span>
        Rose will edit here — confirm to apply
      </p>
      <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
        {nodes}
      </div>
    </div>
  );
}

function StructuredPreviewBanner({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-brand/25 bg-brand-blush/30 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/40">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
        </span>
        {label}
        <span
          className="ml-1 inline-block h-[1em] w-0.5 animate-pulse bg-brand align-middle dark:bg-brand-soft"
          aria-hidden
        />
      </p>
      {children}
    </div>
  );
}

export function LessonEditableBlocks({
  materialId,
  moduleId,
  lessonIndex,
  lesson,
  readOnly = false,
  animateReveal = false,
  compactBuild = false,
  liveMorphing = false,
  liveEditText = null,
  liveEditCaret = null,
  previewEdits = null,
}: {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  lesson: CourseLesson;
  readOnly?: boolean;
  /** When `readOnly`, progressively reveal text (live PDF build theater). */
  animateReveal?: boolean;
  /** Tighter layout while the PDF build preview is streaming in. */
  compactBuild?: boolean;
  /** Show raw streaming text with caret while Refine morphs this lesson. */
  liveMorphing?: boolean;
  /** Surgical in-place edit: full lesson text with a caret at `liveEditCaret`. */
  liveEditText?: string | null;
  /** Caret offset within `liveEditText` (a cursor deleting/typing in place). */
  liveEditCaret?: number | null;
  /** Pre-confirm preview: exact spans / key terms / examples about to change. */
  previewEdits?: ArosesCourseRefinePreviewEdit[] | null;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState(lesson.title);
  const [draftContent, setDraftContent] = useState(lesson.content);
  const [draftTerms, setDraftTerms] = useState<KeyTerm[]>(() =>
    lesson.key_terms.map((k) => ({ ...k }))
  );
  const [draftExamples, setDraftExamples] = useState<string[]>(() => [
    ...lesson.examples,
  ]);

  // Live Refine reveal for the course owner uses the SAME progressive
  // typewriter as course/notes generation — just faster so long lessons don't
  // crawl. This is what makes "Rose is editing" type out character by character.
  const liveReveal = liveMorphing && !readOnly;
  const streamedBody = useTypewriterString(lesson.content ?? "", {
    mode: "chars",
    charsPerTick: liveReveal ? 3 : 1,
    charDelayMs: liveReveal ? 9 : 12,
    instantBelow:
      (readOnly && animateReveal) || liveReveal ? 0 : 2_000_000_000,
  });

  const contentPreviewSpans = (previewEdits ?? [])
    .filter((e) => e.kind === "content")
    .map((e) => ({
      start: e.start ?? 0,
      deleteLen: e.deleteLen ?? 0,
      insert: e.insert ?? "",
    }));
  const keyTermPreviews = (previewEdits ?? []).filter(
    (e) => e.kind === "key_term"
  );
  const examplePreviews = (previewEdits ?? []).filter(
    (e) => e.kind === "example"
  );

  useEffect(() => {
    setDraftTitle(lesson.title);
    setDraftContent(lesson.content);
    setDraftTerms(lesson.key_terms.map((k) => ({ ...k })));
    setDraftExamples([...lesson.examples]);
  }, [lesson]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/modules/${moduleId}/lessons/${lessonIndex}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(
            typeof json.error === "string" ? json.error : "Could not save."
          );
          setSaving(false);
          return;
        }
        setSection(null);
        router.refresh();
      } catch {
        setErr("Network error.");
      }
      setSaving(false);
    },
    [materialId, moduleId, lessonIndex, router]
  );

  const cancel = useCallback(() => {
    setSection(null);
    setErr(null);
    setDraftTitle(lesson.title);
    setDraftContent(lesson.content);
    setDraftTerms(lesson.key_terms.map((k) => ({ ...k })));
    setDraftExamples([...lesson.examples]);
  }, [lesson]);

  const saveTitle = () =>
    void patch({ title: draftTitle.trim() });
  const saveBody = () => void patch({ content: draftContent });
  const saveTerms = () =>
    void patch({
      key_terms: draftTerms.filter(
        (t) => t.term.trim().length > 0 && t.definition.trim().length > 0
      ),
    });
  const saveExamples = () =>
    void patch({
      examples: draftExamples.map((s) => s.trim()).filter((s) => s.length > 0),
    });

  if (readOnly) {
    const titleEl = animateReveal ? (
      <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <TypewriterText
          text={lesson.title}
          instantBelow={0}
          charDelayMs={36}
          charsPerTick={1}
        />
      </h3>
    ) : (
      <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {lesson.title}
      </h3>
    );

    const sourcesEl =
      lesson.sources && lesson.sources.length > 0 ? (
        <LessonSourceAttribution sources={lesson.sources} />
      ) : null;

    const bodyEl = animateReveal ? (
      <div className="mt-1.5">
        <LessonRichContent markdown={streamedBody} />
      </div>
    ) : (
      <div className="mt-1.5">
        <LessonRichContent markdown={lesson.content} />
      </div>
    );

    const sectionGap = compactBuild ? "space-y-4" : "space-y-6";

    return (
      <article className={sectionGap}>
        <LessonQuoteCaptureRegion
          lessonIndex={lessonIndex}
          className={sectionGap}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Lesson content
            </p>
            {bodyEl}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Lesson title
            </p>
            {titleEl}
            {sourcesEl}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Key terms
            </p>
            <div className="mt-3">
              {lesson.key_terms.length === 0 ? (
                <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
                  No key terms for this lesson.
                </p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {lesson.key_terms.map((kt, ki) => (
                    <KeyTermReadOnlyCard
                      key={`${lessonIndex}-${ki}-${kt.term}`}
                      term={kt.term}
                      definition={kt.definition}
                      animateReveal={animateReveal}
                    />
                  ))}
                </dl>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Real-world examples
            </p>
            <div className="mt-3">
              {lesson.examples.length === 0 ? (
                <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
                  No examples for this lesson.
                </p>
              ) : (
                <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                  {lesson.examples.map((ex, ei) => (
                    <li key={`${lessonIndex}-ex-${ei}`}>
                      {animateReveal ? (
                        <TypewriterText
                          text={ex}
                          instantBelow={0}
                          charDelayMs={14}
                          charsPerTick={1}
                        />
                      ) : (
                        ex
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </LessonQuoteCaptureRegion>
      </article>
    );
  }

  return (
    <article className="space-y-6">
      <LessonQuoteCaptureRegion
        lessonIndex={lessonIndex}
        enabled={section === null}
        className="space-y-6"
      >
        {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {err}
        </p>
      ) : null}

      <EditableSection
        label="Lesson title"
        isEditing={section === "title"}
        onEdit={() => setSection("title")}
        onCancel={cancel}
        view={
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {lesson.title}
          </h3>
        }
        edit={
          <div className="space-y-3">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-lg font-semibold text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="button"
              disabled={saving || draftTitle.trim().length < 1}
              onClick={saveTitle}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

      {lesson.sources && lesson.sources.length > 0 ? (
        <LessonSourceAttribution sources={lesson.sources} />
      ) : null}

      <EditableSection
        label="Lesson content"
        isEditing={section === "body"}
        onEdit={() => setSection("body")}
        onCancel={cancel}
        view={
          liveEditText != null ? (
            <div className="relative rounded-lg border border-brand/25 bg-brand-blush/30 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/40">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                </span>
                Rose is editing…
              </p>
              <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                {liveEditText.slice(0, liveEditCaret ?? liveEditText.length)}
                <span
                  className="mx-px inline-block h-[1.15em] w-0.5 animate-pulse bg-brand align-text-bottom dark:bg-brand-soft"
                  aria-hidden
                />
                {liveEditText.slice(liveEditCaret ?? liveEditText.length)}
              </div>
            </div>
          ) : liveMorphing ? (
            <div className="relative rounded-lg border border-brand/25 bg-brand-blush/30 px-3.5 py-3 dark:border-brand/30 dark:bg-[#1e1616]/40">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                </span>
                Rose is editing…
              </p>
              <LessonRichContent markdown={streamedBody} />
              {streamedBody.length < (lesson.content ?? "").length ? (
                <span
                  className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-brand align-text-bottom dark:bg-brand-soft"
                  aria-hidden
                />
              ) : null}
            </div>
          ) : contentPreviewSpans.length > 0 ? (
            <LessonEditPreview
              content={lesson.content ?? ""}
              spans={contentPreviewSpans}
            />
          ) : (
            <LessonRichContent markdown={lesson.content} />
          )
        }
        edit={
          <div className="space-y-3">
            <LessonMarkdownEditor
              materialId={materialId}
              lessonIndex={lessonIndex}
              draft={draftContent}
              onDraftChange={setDraftContent}
              disabled={saving}
            />
            <button
              type="button"
              disabled={saving}
              onClick={saveBody}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      />

      <EditableSection
        label="Key terms"
        isEditing={section === "key_terms"}
        onEdit={() => setSection("key_terms")}
        onCancel={cancel}
        view={
          keyTermPreviews.length > 0 ? (
            <StructuredPreviewBanner label="Rose will change key terms — confirm to apply">
              <dl className="grid gap-3 sm:grid-cols-2">
                {lesson.key_terms.map((kt, ki) => {
                  const removing = keyTermPreviews.some(
                    (p) =>
                      p.action === "remove" &&
                      p.term?.toLowerCase() === kt.term.toLowerCase()
                  );
                  const replacing = keyTermPreviews.find(
                    (p) =>
                      p.action === "replace" &&
                      p.term?.toLowerCase() === kt.term.toLowerCase()
                  );
                  return (
                    <div
                      key={ki}
                      className={`rounded-xl border px-4 py-3 ${
                        removing
                          ? "border-red-300 bg-red-50/80 line-through opacity-70 dark:border-red-900 dark:bg-red-950/40"
                          : replacing
                            ? "border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30"
                            : "border-zinc-200 bg-white/90 dark:border-zinc-800 dark:bg-zinc-900/50"
                      }`}
                    >
                      <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                        {kt.term}
                      </dt>
                      <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {replacing?.definition ?? kt.definition}
                      </dd>
                    </div>
                  );
                })}
                {keyTermPreviews
                  .filter((p) => p.action === "add")
                  .map((p, i) => (
                    <div
                      key={`add-${i}`}
                      className="rounded-xl border border-emerald-300 bg-emerald-50/90 px-4 py-3 ring-2 ring-brand/30 dark:border-emerald-800 dark:bg-emerald-950/40"
                    >
                      <dt className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-200">
                        <span
                          className="inline-block h-[1em] w-0.5 animate-pulse bg-brand"
                          aria-hidden
                        />
                        + {p.term}
                      </dt>
                      <dd className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                        {p.definition}
                      </dd>
                    </div>
                  ))}
              </dl>
            </StructuredPreviewBanner>
          ) : lesson.key_terms.length === 0 ? (
            <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
              No key terms yet — edit to add cards like definitions and glossary
              entries.
            </p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              {lesson.key_terms.map((kt, ki) => (
                <div
                  key={ki}
                  className="rounded-xl border border-zinc-200 bg-white/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                    {kt.term}
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {kt.definition}
                  </dd>
                </div>
              ))}
            </dl>
          )
        }
        edit={
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">
              Add or remove rows. Both term and definition must be filled to save
              a card.
            </p>
            <div className="space-y-3">
              {draftTerms.map((kt, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <input
                      value={kt.term}
                      onChange={(e) => {
                        const next = [...draftTerms];
                        next[i] = { ...next[i], term: e.target.value };
                        setDraftTerms(next);
                      }}
                      placeholder="Term"
                      className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraftTerms(draftTerms.filter((_, j) => j !== i))
                      }
                      className="shrink-0 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    value={kt.definition}
                    onChange={(e) => {
                      const next = [...draftTerms];
                      next[i] = { ...next[i], definition: e.target.value };
                      setDraftTerms(next);
                    }}
                    placeholder="Definition"
                    rows={3}
                    className="mt-2 w-full resize-y rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setDraftTerms([...draftTerms, { term: "", definition: "" }])
              }
              className="text-sm font-semibold text-brand hover:underline dark:text-brand-soft"
            >
              + Add term
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={saveTerms}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
            >
              {saving ? "Saving…" : "Save key terms"}
            </button>
          </div>
        }
      />

      <EditableSection
        label="Real-world examples"
        isEditing={section === "examples"}
        onEdit={() => setSection("examples")}
        onCancel={cancel}
        view={
          examplePreviews.length > 0 ? (
            <StructuredPreviewBanner label="Rose will change examples — confirm to apply">
              <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {lesson.examples.map((ex, ei) => {
                  const removing = examplePreviews.some(
                    (p) =>
                      p.action === "remove" &&
                      ex.toLowerCase().includes((p.example ?? "").toLowerCase())
                  );
                  return (
                    <li
                      key={ei}
                      className={
                        removing
                          ? "text-red-600 line-through opacity-70 dark:text-red-400"
                          : undefined
                      }
                    >
                      {ex}
                    </li>
                  );
                })}
                {examplePreviews
                  .filter((p) => p.action === "add")
                  .map((p, i) => (
                    <li
                      key={`add-ex-${i}`}
                      className="font-medium text-emerald-700 dark:text-emerald-300"
                    >
                      <span
                        className="mr-1 inline-block h-[1em] w-0.5 animate-pulse bg-brand align-middle"
                        aria-hidden
                      />
                      + {p.example}
                    </li>
                  ))}
              </ul>
            </StructuredPreviewBanner>
          ) : lesson.examples.length === 0 ? (
            <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
              No examples yet — edit to add bullet-style examples.
            </p>
          ) : (
            <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              {lesson.examples.map((ex, ei) => (
                <li key={ei}>{ex}</li>
              ))}
            </ul>
          )
        }
        edit={
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              One example per row. Remove text and save to drop an item.
            </p>
            <div className="space-y-2">
              {draftExamples.map((ex, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={ex}
                    onChange={(e) => {
                      const next = [...draftExamples];
                      next[i] = e.target.value;
                      setDraftExamples(next);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraftExamples(draftExamples.filter((_, j) => j !== i))
                    }
                    className="shrink-0 rounded-lg px-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDraftExamples([...draftExamples, ""])}
              className="text-sm font-semibold text-brand hover:underline dark:text-brand-soft"
            >
              + Add example
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={saveExamples}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
            >
              {saving ? "Saving…" : "Save examples"}
            </button>
          </div>
        }
      />
      </LessonQuoteCaptureRegion>
    </article>
  );
}
