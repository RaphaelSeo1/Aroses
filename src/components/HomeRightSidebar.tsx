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

function streakFromBuckets(last7: number[]): number {
  let s = 0;
  for (let i = last7.length - 1; i >= 0; i--) {
    if (last7[i] > 0) s += 1;
    else break;
  }
  return s;
}

export function HomeRightSidebar({
  activityBuckets14,
}: {
  activityBuckets14: number[];
}) {
  const days = weekdayLabelsLast7();
  const last7 = activityBuckets14.slice(-7);
  const streak = streakFromBuckets(last7);

  return (
    <aside className="space-y-5 lg:sticky lg:top-[5.5rem]">
      <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Study streak this week
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Keep a small daily practice habit.
            </p>
          </div>
          <span className="rounded-full bg-brand-blush/80 px-2.5 py-1 text-xs font-semibold text-brand-ink dark:bg-[#1e1616]/70 dark:text-brand-soft">
            {streak} day{streak === 1 ? "" : "s"}
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

        <p className="mt-5 text-sm font-semibold text-brand-ink dark:text-brand-soft">
          {streak}
          <span className="ml-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            day streak — keep it going!
          </span>
        </p>
      </section>
    </aside>
  );
}
