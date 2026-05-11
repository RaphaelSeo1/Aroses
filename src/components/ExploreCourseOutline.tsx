import type { ExploreOutlineGroup } from "@/lib/explore-course-outline";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";

export function ExploreCourseOutline({
  groups,
}: {
  groups: ExploreOutlineGroup[];
}) {
  if (groups.length === 0) return null;

  return (
    <section className="mt-12 rounded-3xl border border-zinc-200/85 bg-white/70 p-6 shadow-lg shadow-zinc-900/[0.04] ring-1 ring-white/60 backdrop-blur-sm dark:border-zinc-700/80 dark:bg-zinc-950/60 dark:shadow-black/20 dark:ring-zinc-700/40 sm:p-8">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="mt-1 hidden h-9 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-red-400 sm:block"
          aria-hidden
        />
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-xl">
            Course structure
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Module titles and section names — use{" "}
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              Start learning
            </strong>{" "}
            above for full lesson text and quizzes.
          </p>
        </div>
      </div>
      <div className="mt-8 space-y-8">
        {groups.map((g) => (
          <div key={`${g.sort}-${g.name}`}>
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              {g.name}
            </h3>
            <ul className="mt-4 space-y-4">
              {g.materials.map((mat, mi) => (
                <li
                  key={`${g.sort}-${mi}-${mat.materialSort}-${mat.fileName}`}
                  className="group rounded-2xl border border-zinc-200/90 bg-white/90 px-5 py-4 shadow-sm transition-[box-shadow,border-color] hover:border-brand-border/60 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/70 dark:hover:border-brand-border/35"
                >
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {displayMaterialSectionLabel(mat.fileName)}
                  </p>
                  {mat.modules.length > 0 ? (
                    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {mat.modules.map((m, i) => (
                        <li key={`${m.id}-${i}`}>{m.title}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-xs italic text-zinc-500">
                      No generated modules yet for this upload.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
