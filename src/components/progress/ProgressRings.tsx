/**
 * Dual concentric rings: outer = module path, inner = quiz accuracy.
 * More informative than a single bar while staying compact.
 */
export function ProgressRings({
  modulePct,
  quizPct,
  size = "lg",
  className = "",
  /** Unique prefix for SVG defs when multiple rings mount on one page. */
  ringId = "pr",
  /** Tailwind classes for stroke dash animation (speedometer-style sweep). */
  strokeTransitionClass = "transition-[stroke-dashoffset] duration-700 ease-out",
  /**
   * `below` = quiz % is not stacked in the center (inner ring only); pair with larger
   * layouts that explain quiz elsewhere. Small rings always print “Modules” under the SVG.
   */
  quizLabelPlacement = "center",
}: {
  modulePct: number;
  quizPct: number | null;
  size?: "xs" | "sm" | "lg";
  className?: string;
  ringId?: string;
  strokeTransitionClass?: string;
  quizLabelPlacement?: "center" | "below";
}) {
  /** Slightly larger small layout so the donut hole clears both strokes + numeric center. */
  const dim = size === "lg" ? 160 : size === "sm" ? 128 : 80;
  const c = dim / 2;
  const outerR = size === "lg" ? 58 : size === "sm" ? 46 : 28;
  const innerR = size === "lg" ? 42 : size === "sm" ? 32 : 19;
  const outerW = size === "lg" ? 9 : size === "sm" ? 5 : 4;
  const innerW = size === "lg" ? 7 : size === "sm" ? 4 : 3;
  const cOuter = 2 * Math.PI * outerR;
  const cInner = 2 * Math.PI * innerR;
  const modClamped = Math.min(100, Math.max(0, modulePct));
  const quizClamped =
    quizPct == null ? null : Math.min(100, Math.max(0, quizPct));
  const offOuter = cOuter - (modClamped / 100) * cOuter;
  const offInner =
    quizClamped == null ? cInner : cInner - (quizClamped / 100) * cInner;

  const quizBelow =
    quizLabelPlacement === "below" && quizClamped != null;

  /** Small rings: keep only numbers inside the donut; label reads cleaner underneath. */
  const moduleLabelBelow = size === "sm";

  const centerPctClass =
    size === "lg"
      ? "text-2xl"
      : size === "xs"
        ? "text-[0.78rem]"
        : quizBelow || moduleLabelBelow
          ? "text-xl"
          : quizClamped != null
            ? "text-[1.0625rem]"
            : "text-lg";

  /** Flex centering sits visually high on numeric + caption stacks; nudge toward donut hole center. */
  const centerAnchorClass =
    !quizBelow && quizClamped != null && !moduleLabelBelow
      ? size === "lg"
        ? "left-1/2 top-[calc(50%+0.28rem)] -translate-x-1/2 -translate-y-1/2"
        : size === "xs"
          ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          : "left-1/2 top-[calc(50%+0.35rem)] -translate-x-1/2 -translate-y-1/2"
      : size === "lg"
        ? "left-1/2 top-[calc(50%+0.14rem)] -translate-x-1/2 -translate-y-1/2"
        : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";

  const ringsInner = (
    <>
      <svg
        width={dim}
        height={dim}
        className="drop-shadow-sm"
        viewBox={`0 0 ${dim} ${dim}`}
        aria-hidden
      >
        <defs>
          <linearGradient
            id={`${ringId}-mod`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="rgb(220 38 38)" />
            <stop offset="100%" stopColor="rgb(185 28 28)" />
          </linearGradient>
          <linearGradient
            id={`${ringId}-quiz`}
            x1="0%"
            y1="100%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="rgb(252 165 165)" />
            <stop offset="100%" stopColor="rgb(220 38 38)" />
          </linearGradient>
        </defs>
        {/* outer track */}
        <circle
          cx={c}
          cy={c}
          r={outerR}
          fill="none"
          stroke="rgb(253 232 232)"
          strokeWidth={outerW}
          className="dark:stroke-zinc-700"
        />
        {/* outer progress */}
        <circle
          cx={c}
          cy={c}
          r={outerR}
          fill="none"
          stroke={`url(#${ringId}-mod)`}
          strokeWidth={outerW}
          strokeLinecap="round"
          strokeDasharray={cOuter}
          strokeDashoffset={offOuter}
          transform={`rotate(-90 ${c} ${c})`}
          className={strokeTransitionClass}
        />
        {/* inner track */}
        <circle
          cx={c}
          cy={c}
          r={innerR}
          fill="none"
          stroke="rgb(253 232 232)"
          strokeWidth={innerW}
          className="dark:stroke-zinc-700"
        />
        {/* inner progress */}
        <circle
          cx={c}
          cy={c}
          r={innerR}
          fill="none"
          stroke={
            quizClamped == null
              ? "rgb(136 136 136)"
              : `url(#${ringId}-quiz)`
          }
          strokeWidth={innerW}
          strokeLinecap="round"
          strokeDasharray={cInner}
          strokeDashoffset={offInner}
          transform={`rotate(-90 ${c} ${c})`}
          className={strokeTransitionClass}
        />
      </svg>
      <div
        className={`pointer-events-none absolute z-10 flex max-w-[min(100%,5.5rem)] flex-col items-center px-1 text-center ${centerAnchorClass}`}
      >
        <span
          className={`block font-bold tabular-nums leading-none text-brand-ink dark:text-white ${centerPctClass}`}
        >
          {modClamped}%
        </span>
        {!moduleLabelBelow && size !== "xs" ? (
          <span className="mt-0.5 block text-[10px] font-medium uppercase leading-none tracking-wide text-brand-muted dark:text-brand-soft">
            modules
          </span>
        ) : null}
        {!quizBelow && quizClamped != null && size !== "xs" ? (
          <span
            className={`mt-1.5 tabular-nums font-semibold leading-none text-brand-ink/90 dark:text-brand-soft ${size === "lg" ? "text-[11px]" : "text-[10px]"}`}
          >
            {Math.round(quizClamped)}% quiz
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={`flex shrink-0 flex-col items-center ${className}`}>
      <div className="relative" style={{ width: dim, height: dim }}>
        {ringsInner}
      </div>
      {moduleLabelBelow ? (
        <p className="mt-1.5 text-center text-[10px] font-semibold uppercase leading-none tracking-wide text-zinc-500 dark:text-zinc-400">
          Modules
        </p>
      ) : null}
    </div>
  );
}
