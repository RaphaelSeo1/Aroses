import { figureCaption } from "@/lib/lesson-content-layout";

export function LessonFigure({
  src,
  alt,
  variant = "primary",
}: {
  src: string;
  alt: string;
  variant?: "primary" | "secondary";
}) {
  const caption = figureCaption(alt);
  const imgClass =
    variant === "primary"
      ? "w-full rounded-lg border border-zinc-200 shadow-sm dark:border-zinc-700"
      : "w-full rounded-md border border-zinc-200 dark:border-zinc-700";

  return (
    <figure className="m-0">
      <img
        src={src}
        alt={caption || alt}
        className={imgClass}
        loading="lazy"
      />
      {caption ? (
        <figcaption className="mt-2 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
