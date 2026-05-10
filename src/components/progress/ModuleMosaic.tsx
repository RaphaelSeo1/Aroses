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
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: tiles }).map((_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-sm transition-[background-color,opacity,transform] duration-200 ease-out sm:h-3 sm:w-3 ${
            i < filled
              ? unit
                ? "bg-brand shadow-sm shadow-red-600/25"
                : "bg-gradient-to-br from-brand to-brand-hover"
              : "bg-brand-border dark:bg-zinc-700"
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
