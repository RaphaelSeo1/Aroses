/** Compact notice for AI-generated lessons, quizzes, and chat. */
export function AiStudyDisclaimer({
  className = "",
  compact = false,
}: {
  className?: string;
  /** Single-line strip for build headers — avoids awkward wraps in wide boxes. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p
        role="note"
        className={[
          "m-0 w-full text-left text-[11px] leading-snug text-zinc-500 dark:text-zinc-400",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          AI-generated content may contain mistakes.
        </span>{" "}
        Use your course materials and instructor as the source of truth.
      </p>
    );
  }

  const wrap = [
    "rounded-xl border border-zinc-200/90 bg-zinc-50/95 px-4 py-2.5 text-xs leading-snug text-zinc-600 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 dark:shadow-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div role="note" className={wrap}>
      <p className="m-0 w-full text-left text-pretty">
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
          AI-generated content may contain mistakes.
        </span>{" "}
        Use your course materials and instructor as the source of truth — not this
        output alone — especially for exams or graded work.
      </p>
    </div>
  );
}
