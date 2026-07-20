import Link from "next/link";

export function LibraryPageHeader({
  backLabel,
  eyebrow,
  title,
  description,
  action,
}: {
  backLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <header>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span aria-hidden>←</span>
        {backLabel}
      </Link>
      <div className="mt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand dark:text-brand-soft">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              {title}
            </h1>
          </div>
          {action ? (
            <Link
              href={action.href}
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
            >
              {action.label}
            </Link>
          ) : null}
        </div>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      </div>
    </header>
  );
}
