"use client";

/**
 * Last N days of quiz activity as a rhythm strip (not a single bar).
 */
export function ActivityRhythm({
  buckets,
  labels,
}: {
  /** Oldest → newest (today last). */
  buckets: number[];
  labels: string[];
}) {
  const max = Math.max(1, ...buckets);
  const peak = Math.max(max, 4);

  return (
    <div className="w-full">
      <div className="flex items-end justify-between gap-1 sm:gap-1.5">
        {buckets.map((n, i) => {
          const hPct = Math.round((n / peak) * 100);
          const hPx = Math.max(n > 0 ? 28 : 8, Math.round((hPct / 100) * 112));
          return (
            <div
              key={i}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div
                className="flex w-full flex-col justify-end rounded-md bg-zinc-100/90 dark:bg-zinc-800/80"
                style={{ height: 112 }}
                title={`${n} attempt${n === 1 ? "" : "s"}`}
              >
                <div
                  className="w-full rounded-md bg-gradient-to-t from-brand via-brand-hover to-brand-soft opacity-90 transition-all dark:from-brand dark:via-brand-hover dark:to-brand-soft"
                  style={{
                    height: hPx,
                    minHeight: n > 0 ? 12 : 4,
                    opacity: n > 0 ? 1 : 0.25,
                  }}
                />
              </div>
              <span className="hidden text-[9px] font-medium text-zinc-400 sm:block dark:text-zinc-500">
                {labels[i] ?? ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>Earlier</span>
        <span>Today</span>
      </div>
    </div>
  );
}
