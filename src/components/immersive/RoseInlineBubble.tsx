"use client";

import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import { TypewriterText } from "@/components/immersive/TypewriterText";

/**
 * Compact Rose speech bubble — sits inline below the source lesson card,
 * not in the bottom composer dock.
 */
export function RoseInlineBubble({
  label,
  text,
  variant,
  animate,
  animateKey,
}: {
  label: string;
  text: string;
  variant: "question" | "reply";
  animate?: boolean;
  animateKey?: string;
}) {
  const shell =
    variant === "question"
      ? "border-amber-200/80 bg-gradient-to-br from-amber-50/95 via-white to-amber-100/75"
      : "border-fuchsia-200/55 bg-fuchsia-50/85";
  const labelClass =
    variant === "question" ? "text-amber-700" : "text-fuchsia-700";

  return (
    <div
      className={`mt-3 max-w-[min(100%,28rem)] rounded-2xl border px-3.5 py-2.5 shadow-sm sm:ml-auto ${shell}`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${labelClass}`}
      >
        {label}
      </p>
      <div className="mt-1 text-[13px] leading-snug text-zinc-800">
        {animate ? (
          <TypewriterText
            key={animateKey ?? text.slice(0, 24)}
            text={text}
            wordIntervalMs={45}
          />
        ) : (
          <StudyChatMessageMarkdown source={text} />
        )}
      </div>
    </div>
  );
}
