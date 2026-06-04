import type { SourceRef } from "@/types/course";
import { formatSourceRefs } from "@/lib/source-attribution";

export function LessonSourceAttribution({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;

  return (
    <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">
      <span className="font-medium text-zinc-400 dark:text-zinc-500">
        Sources
      </span>
      <span aria-hidden="true" className="mx-1.5 text-zinc-300 dark:text-zinc-600">
        ·
      </span>
      {formatSourceRefs(sources)}
    </p>
  );
}
