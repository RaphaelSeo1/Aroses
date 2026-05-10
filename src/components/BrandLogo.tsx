const SRC = "/aroses-icon.png";
const WIDTH = 800;
const HEIGHT = 800;

export function BrandLogo({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded-xl ring-1 ring-brand-border/60 dark:ring-brand-border/40 ${className ?? "h-10 w-10 sm:h-11 sm:w-11"}`}
    >
      <img
        src={SRC}
        alt=""
        width={WIDTH}
        height={HEIGHT}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
