"use client";

/**
 * Last N days of quiz activity — fixed-width columns + horizontal scroll when
 * the container is narrow (avoids unusable 1px-wide bars).
 */
export function ActivityRhythm({
  buckets,
  labels,
}: {
  /** Oldest → newest (today last). */
  buckets: number[];
  labels: string[];
}) {
  const n = buckets.length;
  const max = Math.max(1, ...buckets);
  const peak = Math.max(max, 4);

  const colPx = 20;
  const gapPx = 5;
  const chartMinWidth = n > 0 ? n * colPx + (n - 1) * gapPx : 0;
  const barTrackHeight = 104;

  return (
    <div className="w-full min-w-0">
      <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-zinc-200/70 bg-zinc-50/90 px-3 py-4 dark:border-zinc-700/80 dark:bg-zinc-900/40 [-webkit-overflow-scrolling:touch]">
        <div
          className="mx-auto min-w-0"
          style={{
            width: chartMinWidth > 0 ? `${chartMinWidth}px` : undefined,
            maxWidth: "100%",
          }}
        >
          <div
            className="grid w-full"
            style={{
              gridTemplateColumns:
                n > 0 ? `repeat(${n}, ${colPx}px)` : undefined,
              gap: `${gapPx}px`,
            }}
          >
            {buckets.map((count, i) => {
              const hPct = Math.round((count / peak) * 100);
              const hPx = Math.max(
                count > 0 ? 26 : 8,
                Math.round((hPct / 100) * barTrackHeight)
              );
              return (
                <div
                  key={`bar-${i}`}
                  className="flex flex-col justify-end"
                  title={`${labels[i] ?? "Day " + (i + 1)}: ${count} attempt${count === 1 ? "" : "s"}`}
                >
                  <div
                    className="flex w-full flex-col justify-end rounded-md bg-zinc-200/80 dark:bg-zinc-800/90"
                    style={{ height: barTrackHeight }}
                  >
                    <div
                      className="w-full rounded-md bg-gradient-to-t from-brand via-brand-hover to-brand-soft opacity-90 transition-all dark:from-brand dark:via-brand-hover dark:to-brand-soft"
                      style={{
                        height: hPx,
                        minHeight: count > 0 ? 12 : 4,
                        opacity: count > 0 ? 1 : 0.28,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="mt-2 grid w-full"
            style={{
              gridTemplateColumns:
                n > 0 ? `repeat(${n}, ${colPx}px)` : undefined,
              gap: `${gapPx}px`,
            }}
            aria-hidden
          >
            {labels.slice(0, n).map((label, i) => (
              <span
                key={`lbl-${i}`}
                className="block select-none text-center font-mono text-[10px] font-medium leading-tight text-zinc-600 dark:text-zinc-400"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-between px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <span>Earlier</span>
        <span>Today</span>
      </div>
    </div>
  );
}
