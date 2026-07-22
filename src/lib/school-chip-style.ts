/** Deterministic pastel palette for school chips on Explore. */
const SCHOOL_CHIP_STYLES = [
  "bg-rose-100 text-rose-800 ring-rose-200/80 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-800/60",
  "bg-violet-100 text-violet-800 ring-violet-200/80 dark:bg-violet-950/50 dark:text-violet-200 dark:ring-violet-800/60",
  "bg-sky-100 text-sky-800 ring-sky-200/80 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-800/60",
  "bg-emerald-100 text-emerald-800 ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/60",
  "bg-amber-100 text-amber-900 ring-amber-200/80 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800/60",
  "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200/80 dark:bg-fuchsia-950/50 dark:text-fuchsia-200 dark:ring-fuchsia-800/60",
  "bg-teal-100 text-teal-800 ring-teal-200/80 dark:bg-teal-950/50 dark:text-teal-200 dark:ring-teal-800/60",
  "bg-orange-100 text-orange-900 ring-orange-200/80 dark:bg-orange-950/50 dark:text-orange-200 dark:ring-orange-800/60",
] as const;

export function schoolChipClassName(schoolName: string): string {
  let h = 0;
  const s = schoolName.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h + s.charCodeAt(i) * (i + 3)) % 997;
  }
  return SCHOOL_CHIP_STYLES[Math.abs(h) % SCHOOL_CHIP_STYLES.length]!;
}
