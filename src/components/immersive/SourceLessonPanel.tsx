"use client";

import { memo, type ReactNode } from "react";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { LessonRichContent } from "@/components/LessonRichContent";
import { LessonSourceAttribution } from "@/components/LessonSourceAttribution";
import type { CourseLesson } from "@/types/course";

function SourceLessonPanelImpl({
  lesson,
  keyTerms: _keyTerms,
  narrationText: _narrationText,
  footer,
  className = "",
}: {
  lesson: CourseLesson | undefined;
  keyTerms: string[];
  narrationText?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const lessonContent = lesson?.content?.trim();

  if (!lesson) {
    return null;
  }

  return (
    <GlassPanel className={className} tone="subtle" delayMs={220}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          From your course
        </p>
        <p className="text-[11px] font-medium text-zinc-500">{lesson.title}</p>
      </div>
      {lesson.sources && lesson.sources.length > 0 ? (
        <div className="mt-2">
          <LessonSourceAttribution sources={lesson.sources} />
        </div>
      ) : null}
      <div className="source-lesson-body mt-3 max-h-72 overflow-y-auto pr-1 text-sm leading-relaxed text-zinc-800">
        {lessonContent ? (
          <LessonRichContent markdown={lessonContent} />
        ) : (
          <span className="text-zinc-500 italic">
            No source text available for this section.
          </span>
        )}
      </div>
      {footer ? (
        <div className="mt-4 border-t-2 border-zinc-200/90 pt-4">{footer}</div>
      ) : null}
      <style jsx>{`
        .source-lesson-body :global(h2) {
          font-size: 1.05rem;
          margin-top: 0.75rem;
        }
        .source-lesson-body :global(h3) {
          font-size: 0.975rem;
          margin-top: 0.65rem;
        }
        .source-lesson-body :global(p),
        .source-lesson-body :global(ul),
        .source-lesson-body :global(ol) {
          margin-bottom: 0.65rem;
        }
      `}</style>
    </GlassPanel>
  );
}

export const SourceLessonPanel = memo(SourceLessonPanelImpl);
