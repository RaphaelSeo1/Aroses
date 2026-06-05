"use client";

import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { LessonSourceAttribution } from "@/components/LessonSourceAttribution";
import type { CourseLesson } from "@/types/course";

/**
 * Glass panel that displays the original course lesson the AI is currently
 * teaching from, with the chunk's `keyTerms` rendered as glowing inline
 * marks. The terms pulse briefly when the panel first mounts (i.e. when a
 * new chunk loads) so it's visually obvious which words the tutor is
 * anchored to right now.
 *
 * When `narrationText` is provided (the most recent sentence Rose has
 * spoken aloud), the paragraph whose content overlaps that narration the
 * most is "lit up" — soft amber background + left border accent — and the
 * scroll container auto-scrolls to keep it in view. This is the
 * walk-through-the-lesson behavior from spec §1: as Rose teaches, the
 * student visually sees which part of the source she's currently
 * paraphrasing.
 *
 *   - `lesson`        The CourseLesson to show. Falls back to a friendly
 *                     message when undefined (chunk has no source mapping).
 *   - `keyTerms`      Phrases to glow inside the body. Matched
 *                     case-insensitively, longest-first so "key insight"
 *                     wins over "insight" when both are present.
 *   - `narrationText` Most recent thing Rose said aloud (one sentence is
 *                     ideal — longer chunks dilute the match). Drives the
 *                     follow-along highlight + auto-scroll. Optional.
 */
function SourceLessonPanelImpl({
  lesson,
  keyTerms,
  narrationText,
  footer,
  className = "",
}: {
  lesson: CourseLesson | undefined;
  keyTerms: string[];
  narrationText?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const lessonContent = lesson?.content;
  // Paragraph-level split first so we can pin highlight per paragraph.
  // Inside each paragraph we still inline-mark key terms.
  const paragraphs = useMemo(() => {
    if (!lessonContent) return [];
    // Split on blank lines OR hard breaks; collapse and trim.
    return lessonContent
      .split(/\n\s*\n+|\r\n\r\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [lessonContent]);

  // Per-paragraph segmentation memoized so changing narrationText
  // doesn't re-run key-term matching for the whole body.
  const paragraphSegments = useMemo(() => {
    if (paragraphs.length === 0) return null;
    return paragraphs.map((p) => splitWithKeyTerms(p, keyTerms));
  }, [paragraphs, keyTerms]);

  // Active paragraph = closest match to Rose's current narration. -1
  // means "nothing matched well enough" — we fall back to no highlight
  // rather than highlighting an unrelated paragraph by accident.
  const activeParagraphIdx = useMemo(() => {
    if (!narrationText || paragraphs.length === 0) return -1;
    return findBestMatchParagraph(paragraphs, narrationText);
  }, [paragraphs, narrationText]);

  // Auto-scroll the highlighted paragraph into the middle of the
  // scroll container as Rose progresses. Uses `block: "nearest"` to
  // avoid yanking the page if the paragraph is already visible.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeParagraphIdx < 0) return;
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-pidx="${activeParagraphIdx}"]`
    );
    if (!el) return;
    // Use the container's scroll (not page scroll) to keep the active
    // paragraph centered without disturbing the rest of the layout.
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = root.scrollTop;
    const viewBottom = viewTop + root.clientHeight;
    if (elTop < viewTop + 16 || elBottom > viewBottom - 16) {
      root.scrollTo({
        top: Math.max(0, elTop - root.clientHeight / 3),
        behavior: "smooth",
      });
    }
  }, [activeParagraphIdx]);

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
      <div
        ref={containerRef}
        className="source-lesson-body mt-3 max-h-72 overflow-y-auto pr-1 text-sm leading-relaxed text-zinc-800"
      >
        {paragraphSegments ? (
          paragraphSegments.map((segs, pi) => (
            <p
              key={pi}
              data-pidx={pi}
              className={`source-paragraph ${pi === activeParagraphIdx ? "source-paragraph-active" : ""}`}
            >
              {segs.map((seg, si) =>
                seg.kind === "term" ? (
                  <mark key={si} className="kt-mark">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={si}>{seg.text}</span>
                )
              )}
            </p>
          ))
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
        .source-lesson-body :global(.source-paragraph) {
          margin: 0;
          padding: 0.5rem 0.75rem;
          border-radius: 0.6rem;
          border-left: 3px solid transparent;
          transition:
            background 320ms ease,
            border-color 320ms ease,
            color 320ms ease;
        }
        .source-lesson-body :global(.source-paragraph + .source-paragraph) {
          margin-top: 0.35rem;
        }
        .source-lesson-body :global(.source-paragraph-active) {
          background: linear-gradient(
            120deg,
            rgba(254, 243, 199, 0.55) 0%,
            rgba(253, 230, 138, 0.32) 100%
          );
          border-left-color: rgba(217, 119, 6, 0.55);
          color: #1c1c2a;
        }
        @media (prefers-reduced-motion: reduce) {
          .source-lesson-body :global(.source-paragraph) {
            transition: none;
          }
        }
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

// Memoized so re-renders of the runner (chunkIdx, attempts, voice state…)
// don't re-segment / re-render the source body. Key terms array identity
// is stable across renders because the runner derives it via useMemo.
// We DO want re-renders when narrationText changes since that drives the
// follow-along highlight — React.memo's default shallow comparison
// already handles that since strings compare by value.
export const SourceLessonPanel = memo(SourceLessonPanelImpl);

// ---------------------------------------------------------------------------
// Narration ↔ paragraph matching (walk-through highlight)
// ---------------------------------------------------------------------------

// Common English words we don't count as evidence of a content match —
// otherwise "the/a/is/of" would dominate every overlap score.
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","of","in","to","for","on","at","by","with","as",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","we","you","they","them","their","our","your","his","her","i","me",
  "my","if","so","do","does","did","have","has","had","can","could","should",
  "would","will","shall","not","no","yes","from","into","about","what","when",
  "where","why","how","who","which","just","than","then","there","here","also",
  "very","such","more","most","some","many","much","like","want","make","made",
  "any","all","each","every","other","because","while","one","two","new","get",
  "out","over","up","off","down","now","still","really","even","quite","actually"
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .match(/[a-z][a-z'-]{2,}/g)
    ?.filter((w) => !STOP_WORDS.has(w)) ?? [];
}

/**
 * Returns the index of the paragraph that best matches the narration
 * text, or -1 when no paragraph clears the minimum overlap threshold.
 *
 * Scoring: simple content-word overlap. The narration tokens are
 * de-duped (so repeated common words don't inflate the count); each
 * paragraph's score is the count of paragraph tokens that also appear
 * in the narration set. Ties broken by paragraph order (first wins).
 *
 * Threshold: require ≥2 overlapping content words. Anything less is
 * usually coincidence — better to show no highlight than the wrong one.
 */
function findBestMatchParagraph(
  paragraphs: string[],
  narration: string
): number {
  const narrSet = new Set(tokenize(narration));
  if (narrSet.size < 2) return -1;

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const tokens = tokenize(paragraphs[i]);
    let score = 0;
    for (const w of tokens) if (narrSet.has(w)) score += 1;
    if (score >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
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
