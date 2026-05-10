import type { ExploreOutlineGroup } from "@/lib/explore-course-outline";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";

export function ExploreCourseOutline({
  groups,
}: {
  groups: ExploreOutlineGroup[];
}) {
  if (groups.length === 0) return null;

  return (
    <section className="mt-10 border-t border-zinc-200 pt-10 dark:border-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Course structure
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Module titles and section names — use{" "}
        <strong className="font-medium text-zinc-800 dark:text-zinc-200">
          Start learning
        </strong>{" "}
        below for full lesson text and quizzes.
      </p>
      <div className="mt-6 space-y-8">
        {groups.map((g) => (
          <div key={`${g.sort}-${g.name}`}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {g.name}
            </h3>
            <ul className="mt-3 space-y-5">
              {g.materials.map((mat, mi) => (
                <li
                  key={`${g.sort}-${mi}-${mat.materialSort}-${mat.fileName}`}
                  className="rounded-2xl border border-zinc-200/90 bg-white/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/60"
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {displayMaterialSectionLabel(mat.fileName)}
                  </p>
                  {mat.modules.length > 0 ? (
                    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
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
