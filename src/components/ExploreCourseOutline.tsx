"use client";

import { useRef, useMemo, useState } from "react";
import type { ExploreOutlineGroup } from "@/lib/explore-course-outline";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";

export function ExploreCourseOutline({
  groups,
}: {
  groups: ExploreOutlineGroup[];
}) {
  const [activeGroup, setActiveGroup] = useState<number>(
    () => groups[0]?.sort ?? 0
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const accordionRef = useRef<HTMLDivElement>(null);

  const visibleGroup = useMemo(
    () => groups.find((g) => g.sort === activeGroup) ?? groups[0],
    [activeGroup, groups]
  );

  const visibleItems = useMemo(
    () =>
      (visibleGroup?.materials ?? []).map((mat, mi) => ({
        mat,
        key: `outline-${visibleGroup!.sort}-${mi}-${mat.materialSort}`,
        title: displayMaterialSectionLabel(mat.fileName),
      })),
    [visibleGroup]
  );

  if (groups.length === 0) return null;

  const toggle = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  const switchGroup = (sort: number) => {
    setActiveGroup(sort);
    setOpenKey(null);
    setActiveKey(null);
  };

  const jumpTo = (key: string) => {
    setOpenKey(key);
    setActiveKey(key);
    requestAnimationFrame(() => {
      const container = accordionRef.current;
      const el = document.getElementById(key);
      if (container && el) {
        const containerTop = container.getBoundingClientRect().top;
        const elTop = el.getBoundingClientRect().top;
        container.scrollBy({ top: elTop - containerTop - 16, behavior: "smooth" });
      }
    });
  };

  return (
    <section className="mt-10 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white/75 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/70 backdrop-blur-sm dark:border-zinc-700/70 dark:bg-zinc-950/65 dark:shadow-black/25 dark:ring-zinc-700/40">

      {/* ── Header + tabs ── */}
      <div className="border-b border-zinc-100 px-6 py-5 sm:px-8 sm:py-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-red-400"
            aria-hidden
          />
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl dark:text-zinc-50">
              Course structure
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Click any module to see its lessons.{" "}
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                Start learning
              </strong>{" "}
              above for the full text &amp; quizzes.
            </p>
          </div>
        </div>

        {groups.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2" role="tablist">
            {groups.map((g) => {
              const active = g.sort === activeGroup;
              return (
                <button
                  key={g.sort}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchGroup(g.sort)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-brand bg-brand text-white shadow-sm shadow-red-600/25"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  }`}
                >
                  {g.name}
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                      active
                        ? "bg-white/25 text-white"
                        : "bg-zinc-200/80 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                    }`}
                  >
                    {g.materials.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Body: sidebar + accordion ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)]">

        {/* Sidebar */}
        <aside className="hidden border-r border-zinc-100 bg-zinc-50/60 lg:flex lg:flex-col dark:border-zinc-800 dark:bg-zinc-900/30">
          <nav
            aria-label="Module list"
            className="overflow-y-auto px-3 py-4"
            style={{ maxHeight: "calc(100vh - 16rem)" }}
          >
            <p className="mb-2 px-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              {visibleGroup?.name ?? "Modules"}
            </p>
            <ul className="space-y-0.5">
              {visibleItems.map(({ key, title }) => {
                const active = key === activeKey;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => jumpTo(key)}
                      title={title}
                      className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] leading-snug transition ${
                        active
                          ? "bg-brand/[0.07] font-semibold text-brand dark:bg-brand/[0.12] dark:text-brand-soft"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                          active
                            ? "bg-brand dark:bg-brand-soft"
                            : "bg-zinc-300 dark:bg-zinc-700"
                        }`}
                        aria-hidden
                      />
                      <span className="line-clamp-2">{title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* Accordion — scrolls internally so the page doesn't scroll */}
        <div ref={accordionRef} className="min-w-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5" style={{ maxHeight: "calc(100vh - 16rem)" }}>
          {visibleItems.length > 0 ? (
            <ul className="space-y-2">
              {visibleItems.map(({ mat, key, title }) => {
                const isOpen = openKey === key;
                const count = mat.modules.length;

                return (
                  <li
                    key={key}
                    id={key}
                    className={`scroll-mt-24 overflow-hidden rounded-2xl transition-shadow ${
                      isOpen
                        ? "shadow-md shadow-zinc-900/[0.07] ring-1 ring-brand/20 dark:shadow-black/20 dark:ring-brand/15"
                        : "shadow-sm shadow-zinc-900/[0.04] ring-1 ring-zinc-200/80 dark:ring-zinc-800"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center gap-3 px-4 py-4 text-left transition sm:px-5 ${
                        isOpen
                          ? "bg-brand/[0.05] dark:bg-brand/[0.09]"
                          : "bg-white hover:bg-zinc-50/80 dark:bg-zinc-950/50 dark:hover:bg-zinc-900/60"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                          isOpen
                            ? "bg-brand text-white"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                        aria-hidden
                      >
                        {count > 0 ? count : "·"}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                          {title}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {count > 0
                            ? `${count} lesson${count === 1 ? "" : "s"}`
                            : "No lessons yet"}
                        </p>
                      </div>

                      <svg
                        aria-hidden
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 shrink-0 transition-transform ${
                          isOpen
                            ? "rotate-180 text-brand dark:text-brand-soft"
                            : "text-zinc-400 dark:text-zinc-500"
                        }`}
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className="border-t border-brand/10 bg-brand/[0.03] px-5 pb-4 pt-3 dark:border-brand/10 dark:bg-brand/[0.06]">
                        {mat.modules.length > 0 ? (
                          <ol className="space-y-2">
                            {mat.modules.map((m, i) => (
                              <li
                                key={`${key}-${m.id}-${i}`}
                                className="flex items-start gap-3 text-sm leading-snug text-zinc-700 dark:text-zinc-300"
                              >
                                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white text-[10px] font-bold text-zinc-400 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-700">
                                  {i + 1}
                                </span>
                                {m.title}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-xs italic text-zinc-400 dark:text-zinc-500">
                            No generated modules yet.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-4 text-sm italic text-zinc-400 dark:text-zinc-500">
              No modules in this section yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
