"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { AdminActivityItem } from "@/lib/admin-dashboard-data";

const INK = "#1a0505";
const ACCENT = "#DC2626";

export type AdminCourseRow = {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  is_public: boolean | null;
};

type Props = {
  courses: AdminCourseRow[];
  stats: {
    totalCourses: number;
    totalUsers: number;
    publicCourses: number;
    privateCourses: number;
  };
  activity: AdminActivityItem[];
  loadError: string | null;
};

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function IconCourses({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconLock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  icon,
  iconClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconClass: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm shadow-zinc-900/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <span className={iconClass}>{icon}</span>
      </div>
      <p
        className="mt-3 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl"
        style={{ color: INK }}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function CopyOwnerButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
      style={{ color: INK }}
      aria-label={done ? "Copied" : "Copy owner ID"}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function AdminDashboardClient({
  courses: initialCourses,
  stats,
  activity,
  loadError,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialCourses;
    return initialCourses.filter((c) =>
      (c.title || "Untitled").toLowerCase().includes(q)
    );
  }, [initialCourses, query]);

  const onDelete = useCallback(
    async (courseId: string, title: string) => {
      const ok = window.confirm(
        `Delete “${title || "Untitled"}”? This removes the course and related data for learners.`
      );
      if (!ok) return;
      setDeletingId(courseId);
      try {
        const res = await fetch(`/api/courses/${courseId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          window.alert(j.error ?? "Could not delete course.");
          return;
        }
        router.refresh();
      } finally {
        setDeletingId(null);
      }
    },
    [router]
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
          >
            Admin
          </span>
        </div>
        <h1
          className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl"
          style={{ color: INK }}
        >
          Site operations
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600">
          Manage all courses, users, and platform activity from this dashboard.
          Changes made here affect the entire platform.
        </p>

        {loadError ? (
          <div
            className="mt-8 rounded-2xl border px-4 py-4 text-sm"
            style={{
              borderColor: `${ACCENT}55`,
              backgroundColor: `${ACCENT}0d`,
              color: INK,
            }}
          >
            {loadError}
          </div>
        ) : null}

        {!loadError ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total courses"
              value={stats.totalCourses}
              icon={<IconCourses />}
              iconClass="text-[#DC2626]/90"
            />
            <MetricCard
              label="Total users"
              value={stats.totalUsers}
              icon={<IconUsers />}
              iconClass="text-zinc-400"
            />
            <MetricCard
              label="Public courses"
              value={stats.publicCourses}
              icon={<IconGlobe />}
              iconClass="text-[#DC2626]/80"
            />
            <MetricCard
              label="Private courses"
              value={stats.privateCourses}
              icon={<IconLock />}
              iconClass="text-zinc-400"
            />
          </div>
        ) : null}

        {!loadError ? (
          <section className="mt-14">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h2
                  className="text-xl font-bold tracking-tight sm:text-2xl"
                  style={{ color: INK }}
                >
                  All Courses
                </h2>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600">
                  {filtered.length}
                  {query.trim() ? ` / ${initialCourses.length}` : ""}
                </span>
              </div>
              <label className="block w-full sm:max-w-xs">
                <span className="sr-only">Search courses</span>
                <input
                  type="search"
                  placeholder="Search by course name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-inner shadow-zinc-900/[0.02] outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-[#DC2626]/20"
                />
              </label>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr
                      className="border-b border-zinc-200 bg-zinc-50/90"
                      style={{ color: INK }}
                    >
                      <th className="px-4 py-3.5 font-semibold sm:px-5">
                        Course name
                      </th>
                      <th className="hidden px-4 py-3.5 font-semibold md:table-cell md:px-5">
                        Owner ID
                      </th>
                      <th className="px-4 py-3.5 font-semibold sm:px-5">
                        Visibility
                      </th>
                      <th className="px-4 py-3.5 text-right font-semibold sm:px-5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-5 py-10 text-center text-zinc-500"
                        >
                          No courses match your search.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((c, index) => {
                        const isPublic = Boolean(c.is_public);
                        return (
                          <tr
                            key={c.id}
                            className={
                              index % 2 === 0
                                ? "bg-white"
                                : "bg-zinc-50/70"
                            }
                          >
                            <td className="border-t border-zinc-100 px-4 py-3.5 sm:px-5">
                              <span
                                className="font-semibold"
                                style={{ color: INK }}
                              >
                                {c.title?.trim() || "Untitled"}
                              </span>
                              <div className="mt-2 md:hidden">
                                <span className="text-xs text-zinc-500">
                                  {c.user_id.slice(0, 10)}…
                                </span>
                                <CopyOwnerButton text={c.user_id} />
                              </div>
                            </td>
                            <td className="hidden border-t border-zinc-100 px-4 py-3.5 md:table-cell md:px-5">
                              <div className="flex items-center gap-2">
                                <span
                                  className="max-w-[200px] truncate text-xs text-zinc-600 lg:max-w-[280px]"
                                  title={c.user_id}
                                >
                                  {c.user_id}
                                </span>
                                <CopyOwnerButton text={c.user_id} />
                              </div>
                            </td>
                            <td className="border-t border-zinc-100 px-4 py-3.5 sm:px-5">
                              {isPublic ? (
                                <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/15">
                                  Public
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-300/60">
                                  Private
                                </span>
                              )}
                            </td>
                            <td className="border-t border-zinc-100 px-4 py-3.5 text-right sm:px-5">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Link
                                  href={`/dashboard/courses/${c.id}`}
                                  className="inline-flex rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                                >
                                  View
                                </Link>
                                <button
                                  type="button"
                                  disabled={deletingId === c.id}
                                  onClick={() =>
                                    void onDelete(
                                      c.id,
                                      c.title?.trim() || "Untitled"
                                    )
                                  }
                                  className="inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition enabled:hover:opacity-90 disabled:opacity-50"
                                  style={{ backgroundColor: ACCENT }}
                                >
                                  {deletingId === c.id ? "…" : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {!loadError && activity.length > 0 ? (
          <section className="mt-16">
            <h2
              className="text-xl font-bold tracking-tight sm:text-2xl"
              style={{ color: INK }}
            >
              Recent activity
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Newest events from course creation and new accounts.
            </p>
            <ul className="mt-6 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold" style={{ color: INK }}>
                      {a.detail}
                    </p>
                    <p className="text-sm text-zinc-600">{a.title}</p>
                  </div>
                  <time
                    className="shrink-0 text-xs font-medium text-zinc-500 sm:text-right"
                    dateTime={a.at}
                  >
                    {formatWhen(a.at)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
