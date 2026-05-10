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
}: {
  modulePct: number;
  quizPct: number | null;
  size?: "sm" | "lg";
  className?: string;
  ringId?: string;
}) {
  const dim = size === "lg" ? 160 : 112;
  const c = dim / 2;
  const outerR = size === "lg" ? 58 : 40;
  const innerR = size === "lg" ? 42 : 28;
  const outerW = size === "lg" ? 9 : 6;
  const innerW = size === "lg" ? 7 : 5;
  const cOuter = 2 * Math.PI * outerR;
  const cInner = 2 * Math.PI * innerR;
  const modClamped = Math.min(100, Math.max(0, modulePct));
  const quizClamped =
    quizPct == null ? null : Math.min(100, Math.max(0, quizPct));
  const offOuter = cOuter - (modClamped / 100) * cOuter;
  const offInner =
    quizClamped == null ? cInner : cInner - (quizClamped / 100) * cInner;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: dim, height: dim }}
    >
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
          className="transition-[stroke-dashoffset] duration-700 ease-out"
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
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          className={`font-bold tabular-nums text-brand-ink dark:text-white ${size === "lg" ? "text-2xl" : "text-lg"}`}
        >
          {modClamped}%
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-brand-muted dark:text-brand-soft">
          modules
        </span>
      </div>
    </div>
  );
}
