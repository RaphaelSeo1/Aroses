/**
 * Discrete tiles for module completion — clearer than one anonymous bar.
 */
export function ModuleMosaic({
  completed,
  total,
  maxTiles = 24,
}: {
  completed: number;
  total: number;
  /** Cap tiles so huge courses stay readable. */
  maxTiles?: number;
}) {
  if (total <= 0) {
    return (
      <p className="text-xs text-brand-muted dark:text-brand-soft">No modules yet</p>
    );
  }

  const tiles = Math.min(total, maxTiles);
  const filled = Math.round((completed / total) * tiles);
  const unit = completed === total && total > 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: tiles }).map((_, i) => (
        <span
          key={i}
          className={`h-3 w-3 rounded transition-[background-color,opacity,transform] duration-200 ease-out sm:h-3.5 sm:w-3.5 ${
            i < filled
              ? unit
                ? "bg-brand shadow-sm shadow-red-600/20 ring-1 ring-black/5 dark:ring-white/10"
                : "bg-gradient-to-br from-brand to-brand-hover ring-1 ring-black/5 dark:ring-white/10"
              : "bg-zinc-200/95 ring-1 ring-zinc-300/80 dark:bg-zinc-700/90 dark:ring-zinc-600/80"
          }`}
          title={
            i < filled
              ? "Completed module slot"
              : "Remaining module slot"
          }
        />
      ))}
      {total > maxTiles ? (
        <span className="ml-1 self-center text-[10px] text-brand-muted">
          +{total - maxTiles} more
        </span>
      ) : null}
    </div>
  );
}
