"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EditableSection } from "@/components/EditableSection";
import { LessonImage } from "@/components/LessonImage";
import { LessonMarkdownEditor } from "@/components/LessonMarkdownEditor";
import { LessonQuoteCaptureRegion } from "@/components/LessonQuoteCaptureRegion";
import { LessonRichContent } from "@/components/LessonRichContent";
import { TypewriterText, useTypewriterString } from "@/components/TypewriterText";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
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

export function LessonEditableBlocks({
  materialId,
  moduleId,
  lessonIndex,
  lesson,
  readOnly = false,
  animateReveal = false,
}: {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  lesson: CourseLesson;
  readOnly?: boolean;
  /** When `readOnly`, progressively reveal text (live PDF build theater). */
  animateReveal?: boolean;
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

  const hasSourceImages = lessonMarkdownHasImages(lesson.content);

  const streamedBody = useTypewriterString(lesson.content ?? "", {
    mode: "chars",
    charsPerTick: 1,
    charDelayMs: 12,
    instantBelow:
      readOnly && animateReveal ? 0 : 2_000_000_000,
  });

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
      <h3 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <TypewriterText
          text={lesson.title}
          instantBelow={0}
          charDelayMs={36}
          charsPerTick={1}
        />
      </h3>
    ) : (
      <h3 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {lesson.title}
      </h3>
    );

    const bodyEl = animateReveal ? (
      <div className="mt-3">
        <LessonRichContent markdown={streamedBody} />
      </div>
    ) : (
      <div className="mt-3">
        <LessonRichContent markdown={lesson.content} />
      </div>
    );

    return (
      <article className="space-y-6">
        <LessonQuoteCaptureRegion
          lessonIndex={lessonIndex}
          className="space-y-6"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Lesson title
            </p>
            {titleEl}
          </div>
          {/* Lazily-loaded licensed image from Wikimedia Commons.
              Renders nothing when the classifier said this lesson
              doesn't need one or no usable match was found. */}
          {!hasSourceImages ? (
            <LessonImage
              materialId={materialId}
              moduleId={moduleId}
              lessonIndex={lessonIndex}
              canManage={!readOnly}
            />
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Lesson content
            </p>
            {bodyEl}
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

      {!hasSourceImages ? (
        <LessonImage
          materialId={materialId}
          moduleId={moduleId}
          lessonIndex={lessonIndex}
          canManage={!readOnly}
        />
      ) : null}

      <EditableSection
        label="Lesson content"
        isEditing={section === "body"}
        onEdit={() => setSection("body")}
        onCancel={cancel}
        view={<LessonRichContent markdown={lesson.content} />}
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
          lesson.key_terms.length === 0 ? (
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
          lesson.examples.length === 0 ? (
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
