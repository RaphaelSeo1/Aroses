"use client";

import { useMemo } from "react";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import type { CourseLesson } from "@/types/course";

/**
 * Glass panel that displays the original course lesson the AI is currently
 * teaching from, with the chunk's `keyTerms` rendered as glowing inline
 * marks. The terms pulse briefly when the panel first mounts (i.e. when a
 * new chunk loads) so it's visually obvious which words the tutor is
 * anchored to right now.
 *
 *   - `lesson`       The CourseLesson to show. Falls back to a friendly
 *                    message when undefined (chunk has no source mapping).
 *   - `keyTerms`     Phrases to glow inside the body. Matched
 *                    case-insensitively, longest-first so "key insight"
 *                    wins over "insight" when both are present.
 *   - `panelKey`     Bumped by the parent to re-trigger the pulse animation
 *                    when the chunk changes.
 */
export function SourceLessonPanel({
  lesson,
  keyTerms,
}: {
  lesson: CourseLesson | undefined;
  keyTerms: string[];
}) {
  const segments = useMemo(() => {
    if (!lesson?.content) return null;
    return splitWithKeyTerms(lesson.content, keyTerms);
  }, [keyTerms, lesson?.content]);

  if (!lesson) {
    return null;
  }

  return (
    <GlassPanel className="mt-4" tone="subtle" delayMs={220}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          From your course
        </p>
        <p className="text-[11px] font-medium text-zinc-500">{lesson.title}</p>
      </div>
      <div className="source-lesson-body mt-3 max-h-72 overflow-y-auto pr-1 text-sm leading-relaxed text-zinc-800">
        {segments ? (
          segments.map((seg, i) =>
            seg.kind === "term" ? (
              <mark key={i} className="kt-mark">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )
        ) : (
          <span className="text-zinc-500 italic">
            No source text available for this section.
          </span>
        )}
      </div>
      <style jsx>{`
        .source-lesson-body :global(.kt-mark) {
          background: linear-gradient(
            120deg,
            rgba(251, 207, 232, 0.45) 0%,
            rgba(216, 180, 254, 0.5) 100%
          );
          color: #1f1f2b;
          border-radius: 0.35rem;
          padding: 0.05rem 0.3rem;
          margin: 0 0.05rem;
          box-shadow: 0 0 0 1px rgba(217, 70, 239, 0.18);
          animation: kt-pulse 1.8s ease-in-out 2;
          white-space: normal;
        }
        @keyframes kt-pulse {
          0% {
            box-shadow:
              0 0 0 1px rgba(217, 70, 239, 0.18),
              0 0 0 0 rgba(217, 70, 239, 0);
          }
          40% {
            box-shadow:
              0 0 0 1px rgba(217, 70, 239, 0.35),
              0 0 14px 4px rgba(217, 70, 239, 0.28);
          }
          100% {
            box-shadow:
              0 0 0 1px rgba(217, 70, 239, 0.18),
              0 0 0 0 rgba(217, 70, 239, 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .source-lesson-body :global(.kt-mark) {
            animation: none;
          }
        }
      `}</style>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

type Segment = { kind: "text" | "term"; text: string };

/**
 * Splits `content` into a flat array of plain-text + key-term segments.
 *
 * Algorithm:
 *   1. Sort terms by length desc so longer phrases match before substrings.
 *   2. Build a single case-insensitive regex with alternation, escaping
 *      regex metacharacters in each term.
 *   3. Walk `content` collecting plain runs + matched terms.
 *
 * Edge cases handled:
 *   - Empty / whitespace-only terms are filtered out.
 *   - Overlapping matches are resolved by the regex engine (first wins).
 *   - Original surface form (case) is preserved by using `match[0]` from
 *     the source, not the pattern.
 */
function splitWithKeyTerms(content: string, terms: string[]): Segment[] {
  const cleaned = terms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    // Longest first so "neural network" matches before "neural".
    .sort((a, b) => b.length - a.length);

  if (cleaned.length === 0) {
    return [{ kind: "text", text: content }];
  }

  const escaped = cleaned.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

  const out: Segment[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (m.index > lastIdx) {
      out.push({ kind: "text", text: content.slice(lastIdx, m.index) });
    }
    out.push({ kind: "term", text: m[0] });
    lastIdx = m.index + m[0].length;
    // Defensive: avoid infinite loop on zero-length matches.
    if (m[0].length === 0) pattern.lastIndex++;
  }
  if (lastIdx < content.length) {
    out.push({ kind: "text", text: content.slice(lastIdx) });
  }
  return out;
}
