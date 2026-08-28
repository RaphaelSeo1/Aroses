"use client";

import { useMemo } from "react";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function HighlightedSummary({
  summary,
  keyConcepts,
}: {
  summary: string;
  keyConcepts: string[];
}) {
  const segments = useMemo(() => {
    const terms = keyConcepts
      .map((t) => t.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    if (!terms.length) {
      return [{ text: summary, mark: false }];
    }

    const pattern = terms.map(escapeRegExp).join("|");
    if (!pattern) {
      return [{ text: summary, mark: false }];
    }

    const re = new RegExp(`(${pattern})`, "gi");
    const out: { text: string; mark: boolean }[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(summary)) !== null) {
      if (m.index > lastIndex) {
        out.push({
          text: summary.slice(lastIndex, m.index),
          mark: false,
        });
      }
      out.push({ text: m[0], mark: true });
      lastIndex = m.index + m[0].length;
      if (re.lastIndex === m.index) re.lastIndex++;
    }

    if (lastIndex < summary.length) {
      out.push({ text: summary.slice(lastIndex), mark: false });
    }

    return out.length ? out : [{ text: summary, mark: false }];
  }, [summary, keyConcepts]);

  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none text-base leading-relaxed">
      <p className="whitespace-pre-wrap">
        {segments.map((seg, i) =>
          seg.mark ? (
            <mark
              key={i}
              className="rounded-sm bg-amber-200/90 px-0.5 font-semibold text-inherit dark:bg-amber-400/35"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
    </div>
  );
}
