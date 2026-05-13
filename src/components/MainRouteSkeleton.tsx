type MainRouteSkeletonProps = {
  /** Wider grid placeholder for Explore. */
  variant?: "home" | "explore";
  /** Tailwind max-width class for the inner container. */
  maxWidthClass?: string;
};

/**
 * Pulse placeholder for main app routes. No outer `<main>` — parent supplies layout
 * so we do not nest `<main>` when used inside an existing main (e.g. Profile).
 */
export function RouteContentSkeleton({
  variant = "home",
  maxWidthClass,
}: MainRouteSkeletonProps) {
  const max =
    maxWidthClass ??
    (variant === "explore" ? "max-w-7xl" : "max-w-6xl");
  return (
    <div className={`mx-auto ${max} px-4 py-10 sm:px-6 sm:py-14`}>
      <div className="animate-pulse space-y-6">
        <div className="h-4 w-24 rounded-full bg-zinc-300/80 dark:bg-zinc-600/80" />
        <div className="h-10 max-w-md rounded-lg bg-zinc-200/90 dark:bg-zinc-700/80" />
        <div className="h-4 max-w-xl rounded bg-zinc-200/80 dark:bg-zinc-700/70" />
        <div className="h-4 max-w-lg rounded bg-zinc-200/70 dark:bg-zinc-700/60" />
        {variant === "explore" ? (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/70"
              />
            ))}
          </div>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="h-36 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/70" />
            <div className="h-36 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/70" />
          </div>
        )}
      </div>
    </div>
  );
}

export function MainRouteSkeleton(props: MainRouteSkeletonProps) {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
      <RouteContentSkeleton {...props} />
    </main>
  );
}

/** Listing area only — pairs with Explore header rendered outside Suspense. */
export function ExploreListBodySkeleton() {
  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
      <RouteContentSkeleton variant="explore" />
    </main>
  );
}
