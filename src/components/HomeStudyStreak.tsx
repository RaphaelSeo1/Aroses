"use client";

function weekdayLabelsLast7(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ key: d.toISOString().slice(0, 10), label: names[d.getDay()] });
  }
  return out;
}

export function HomeStudyStreak({
  activityBuckets14,
  title,
  hint,
  streakLabel,
  compact = false,
}: {
  activityBuckets14: number[];
  title: string;
  hint: string;
  streakLabel: string;
  compact?: boolean;
}) {
  const days = weekdayLabelsLast7();
  const last7 = activityBuckets14.slice(-7);

  if (compact) {
    return (
      <section className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 p-3 shadow-md shadow-zinc-900/[0.04] ring-1 ring-white/50 dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-200">
            {title}
          </p>
          <span className="shrink-0 rounded-full bg-brand-blush/80 px-2 py-0.5 text-[10px] font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
            {streakLabel}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-7 gap-1">
          {days.map((d, i) => {
            const n = last7[i] ?? 0;
            const active = n > 0;
            const today = i === 6;
            return (
              <div key={d.key} className="text-center">
                <div
                  className={[
                    "mx-auto h-5 w-5 rounded-md border",
                    active
                      ? "border-brand/40 bg-brand shadow-[0_0_10px_rgba(220,38,38,0.2)]"
                      : today
                        ? "border-brand/30 bg-white dark:bg-zinc-950"
                        : "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40",
                  ].join(" ")}
                  title={`${d.label}: ${n} attempt${n === 1 ? "" : "s"}`}
                />
                <p className="mt-0.5 text-[8px] font-medium text-zinc-400 dark:text-zinc-500">
                  {d.label.charAt(0)}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        </div>
        <span className="rounded-full bg-brand-blush/80 px-2.5 py-1 text-xs font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
          {streakLabel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const n = last7[i] ?? 0;
          const active = n > 0;
          const today = i === 6;
          return (
            <div key={d.key} className="text-center">
              <div
                className={[
                  "mx-auto h-9 w-9 rounded-xl border",
                  active
                    ? "border-brand/40 bg-brand shadow-[0_0_18px_rgba(220,38,38,0.25)]"
                    : today
                      ? "border-brand/40 bg-white dark:bg-zinc-950"
                      : "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40",
                ].join(" ")}
                title={`${d.label}: ${n} attempt${n === 1 ? "" : "s"}`}
              />
              <p className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {d.label}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
