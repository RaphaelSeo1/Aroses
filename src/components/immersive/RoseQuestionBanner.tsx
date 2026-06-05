"use client";

/** Current check question — full width below the section title. */
export function RoseQuestionBanner({ question }: { question: string }) {
  const text = question.trim();
  if (!text) return null;

  return (
    <div className="mt-5 rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50/95 via-white to-amber-50/80 px-4 py-3 shadow-sm sm:px-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">
        Rose asks
      </p>
      <p className="mt-0.5 text-[11px] text-amber-800/80">
        Answer this in your own words to move on — other chat questions don&apos;t
        count until you do.
      </p>
      <p className="mt-1.5 text-sm leading-snug text-zinc-800 sm:text-[15px]">{text}</p>
    </div>
  );
}
