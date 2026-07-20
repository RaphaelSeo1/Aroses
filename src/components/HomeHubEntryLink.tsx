import Link from "next/link";
import type { ReactNode } from "react";

export type HomeHubEntryVariant =
  | "notes"
  | "courses"
  | "studying"
  | "shared"
  | "create"
  | "tutor"
  | "sessions"
  | "explore";

const variantStyles: Record<
  HomeHubEntryVariant,
  {
    icon: ReactNode;
    iconWrap: string;
    hoverBorder: string;
    arrowHover: string;
    cardBg: string;
    cornerGlow: string;
    /** Soft outer glow on a status-style dot next to the count. */
    countDot: string;
  }
> = {
  notes: {
    iconWrap:
      "bg-violet-100 text-violet-700 ring-violet-200/70 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900/50",
    hoverBorder: "hover:border-violet-200 dark:hover:border-violet-800",
    arrowHover:
      "group-hover:text-violet-600 dark:group-hover:text-violet-400",
    cardBg:
      "bg-gradient-to-br from-violet-50/80 via-white to-white dark:from-violet-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-violet-200/50 group-hover:bg-violet-200/70 dark:bg-violet-900/30",
    countDot:
      "bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.22)] dark:bg-violet-400 dark:shadow-[0_0_0_3px_rgba(139,92,246,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M8 7h8M8 11h6" />
      </svg>
    ),
  },
  courses: {
    iconWrap:
      "bg-rose-100 text-rose-700 ring-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/50",
    hoverBorder: "hover:border-rose-200 dark:hover:border-rose-800",
    arrowHover: "group-hover:text-rose-600 dark:group-hover:text-rose-300",
    cardBg:
      "bg-gradient-to-br from-rose-50/80 via-white to-white dark:from-rose-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-rose-200/50 group-hover:bg-rose-200/70 dark:bg-rose-900/30",
    countDot:
      "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.22)] dark:bg-rose-400 dark:shadow-[0_0_0_3px_rgba(244,63,94,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  studying: {
    iconWrap:
      "bg-emerald-100 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900/50",
    hoverBorder: "hover:border-emerald-200 dark:hover:border-emerald-800",
    arrowHover:
      "group-hover:text-emerald-600 dark:group-hover:text-emerald-400",
    cardBg:
      "bg-gradient-to-br from-emerald-50/80 via-white to-white dark:from-emerald-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-emerald-200/50 group-hover:bg-emerald-200/70 dark:bg-emerald-900/30",
    countDot:
      "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)] dark:bg-emerald-400 dark:shadow-[0_0_0_3px_rgba(16,185,129,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    ),
  },
  shared: {
    iconWrap:
      "bg-indigo-100 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900/50",
    hoverBorder: "hover:border-indigo-200 dark:hover:border-indigo-800",
    arrowHover:
      "group-hover:text-indigo-600 dark:group-hover:text-indigo-400",
    cardBg:
      "bg-gradient-to-br from-indigo-50/80 via-white to-white dark:from-indigo-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-indigo-200/50 group-hover:bg-indigo-200/70 dark:bg-indigo-900/30",
    countDot:
      "bg-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.22)] dark:bg-indigo-400 dark:shadow-[0_0_0_3px_rgba(99,102,241,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  create: {
    iconWrap:
      "bg-rose-100 text-rose-700 ring-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/50",
    hoverBorder: "hover:border-rose-200 dark:hover:border-rose-800",
    arrowHover: "group-hover:text-rose-600 dark:group-hover:text-rose-300",
    cardBg:
      "bg-gradient-to-br from-rose-50/80 via-white to-white dark:from-rose-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-rose-200/50 group-hover:bg-rose-200/70 dark:bg-rose-900/30",
    countDot:
      "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.22)] dark:bg-rose-400 dark:shadow-[0_0_0_3px_rgba(244,63,94,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    ),
  },
  tutor: {
    iconWrap:
      "bg-violet-100 text-violet-700 ring-violet-200/70 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900/50",
    hoverBorder: "hover:border-violet-200 dark:hover:border-violet-800",
    arrowHover:
      "group-hover:text-violet-600 dark:group-hover:text-violet-400",
    cardBg:
      "bg-gradient-to-br from-violet-50/80 via-white to-white dark:from-violet-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-violet-200/50 group-hover:bg-violet-200/70 dark:bg-violet-900/30",
    countDot:
      "bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.22)] dark:bg-violet-400 dark:shadow-[0_0_0_3px_rgba(139,92,246,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  sessions: {
    iconWrap:
      "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200/70 dark:bg-fuchsia-950/60 dark:text-fuchsia-300 dark:ring-fuchsia-900/50",
    hoverBorder: "hover:border-fuchsia-200 dark:hover:border-fuchsia-800",
    arrowHover:
      "group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400",
    cardBg:
      "bg-gradient-to-br from-fuchsia-50/80 via-white to-white dark:from-fuchsia-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-fuchsia-200/50 group-hover:bg-fuchsia-200/70 dark:bg-fuchsia-900/30",
    countDot:
      "bg-fuchsia-500 shadow-[0_0_0_3px_rgba(217,70,239,0.22)] dark:bg-fuchsia-400 dark:shadow-[0_0_0_3px_rgba(217,70,239,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  explore: {
    iconWrap:
      "bg-sky-100 text-sky-700 ring-sky-200/70 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900/50",
    hoverBorder: "hover:border-sky-200 dark:hover:border-sky-800",
    arrowHover: "group-hover:text-sky-600 dark:group-hover:text-sky-400",
    cardBg:
      "bg-gradient-to-br from-sky-50/80 via-white to-white dark:from-sky-950/30 dark:via-zinc-950 dark:to-zinc-950",
    cornerGlow:
      "bg-sky-200/50 group-hover:bg-sky-200/70 dark:bg-sky-900/30",
    countDot:
      "bg-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.22)] dark:bg-sky-400 dark:shadow-[0_0_0_3px_rgba(14,165,233,0.28)]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
};

function CountPill({
  count,
  dotClass,
  size = "sm",
}: {
  count: number;
  dotClass: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white font-semibold tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
        size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]",
      ].join(" ")}
    >
      <span
        className={["h-1.5 w-1.5 shrink-0 rounded-full", dotClass].join(" ")}
        aria-hidden
      />
      {count}
    </span>
  );
}

/** Minimal home-screen entry link — icon, label, hint, optional count badge. */
export function HomeHubEntryLink({
  href,
  label,
  hint,
  variant,
  count,
  size = "default",
  layout = "row",
  dataTour,
}: {
  href: string;
  label: string;
  hint: string;
  variant: HomeHubEntryVariant;
  count?: number;
  size?: "default" | "lg";
  layout?: "row" | "tile";
  /** Product-tour spotlight target (`data-tour`). */
  dataTour?: string;
}) {
  const styles = variantStyles[variant];
  const isLg = size === "lg";

  if (layout === "tile") {
    return (
      <Link
        href={href}
        data-tour={dataTour}
        className={[
          "group relative flex h-full min-h-[8.25rem] flex-col overflow-hidden rounded-xl border border-zinc-200/90 p-4 shadow-sm ring-1 ring-white/50 transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:ring-zinc-700/30",
          styles.cardBg,
          styles.hoverBorder,
        ].join(" ")}
      >
        <div
          className={[
            "pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl transition",
            styles.cornerGlow,
          ].join(" ")}
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-2">
          <span
            className={[
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1",
              styles.iconWrap,
            ].join(" ")}
          >
            {styles.icon}
          </span>
          <span
            className={[
              "shrink-0 text-base text-zinc-300 transition group-hover:translate-x-0.5 dark:text-zinc-600",
              styles.arrowHover,
            ].join(" ")}
            aria-hidden
          >
            →
          </span>
        </div>
        <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
              {label}
            </p>
            {typeof count === "number" && count > 0 ? (
              <CountPill count={count} dotClass={styles.countDot} />
            ) : null}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      data-tour={dataTour}
      className={[
        "group relative block overflow-hidden rounded-3xl border border-zinc-200/90 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:ring-zinc-700/30",
        styles.cardBg,
        isLg ? "p-5" : "p-4",
        styles.hoverBorder,
      ].join(" ")}
    >
      <div
        className={[
          "pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-2xl transition",
          styles.cornerGlow,
        ].join(" ")}
        aria-hidden
      />
      <div
        className={[
          "relative flex items-center",
          isLg ? "gap-4" : "gap-3",
        ].join(" ")}
      >
        <span
          className={[
            "inline-flex shrink-0 items-center justify-center rounded-xl ring-1",
            isLg ? "h-12 w-12" : "h-10 w-10",
            styles.iconWrap,
          ].join(" ")}
        >
          <span className={isLg ? "scale-110" : undefined}>{styles.icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={[
                "font-semibold text-zinc-900 dark:text-zinc-50",
                isLg ? "text-base" : "text-sm",
              ].join(" ")}
            >
              {label}
            </p>
            {typeof count === "number" && count > 0 ? (
              <CountPill
                count={count}
                dotClass={styles.countDot}
                size={isLg ? "md" : "sm"}
              />
            ) : null}
          </div>
          <p
            className={[
              "text-zinc-500 dark:text-zinc-400",
              isLg ? "mt-1 text-sm leading-snug" : "mt-0.5 text-xs",
            ].join(" ")}
          >
            {hint}
          </p>
        </div>
        <span
          className={[
            "shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 dark:text-zinc-600",
            isLg ? "text-xl" : "text-lg",
            styles.arrowHover,
          ].join(" ")}
          aria-hidden
        >
          →
        </span>
      </div>
    </Link>
  );
}
