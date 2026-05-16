"use client";

export type TranscriptFilter = "both" | "user" | "assistant" | "none";

export type VoiceUserTranscriptLine = {
  id: string;
  ts: number;
  text: string;
  bullets?: string[];
  interrupted?: boolean;
};

export type VoiceAiTranscriptSegment = {
  id: string;
  kind: "text" | "divider";
  content: string;
  label?: string;
};

type Props = {
  open: boolean;
  onOpenChange?: (next: boolean) => void;
  filter: TranscriptFilter;
  onFilterChange: (next: TranscriptFilter) => void;
  micActive: boolean;
  aiSpeaking: boolean;
  partialUserText: string;
  userLines: VoiceUserTranscriptLine[];
  aiSegments: VoiceAiTranscriptSegment[];
  liveAssistantText: string;
  assistantHighlight: { start: number; end: number } | null;
  floating?: boolean;
};

function formatClock(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function VoiceTutorTranscriptSidebar({
  open,
  onOpenChange,
  filter,
  onFilterChange,
  micActive,
  aiSpeaking,
  partialUserText,
  userLines,
  aiSegments,
  liveAssistantText,
  assistantHighlight,
  floating = true,
}: Props) {
  const showUser = filter === "both" || filter === "user";
  const showAi = filter === "both" || filter === "assistant";

  const panelClass = floating
    ? "fixed bottom-[22rem] right-6 z-[95] h-[min(20rem,44vh)] w-[min(16rem,calc(100vw-2rem))] shadow-2xl shadow-black/15 dark:shadow-black/45 sm:bottom-[23rem]"
    : "h-[min(20rem,42vh)] w-full shadow-xl shadow-black/10 dark:shadow-black/35";

  return (
    <aside
      className={
        open
          ? `${panelClass} flex flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/88 text-xs ring-1 ring-zinc-900/5 backdrop-blur-xl dark:border-zinc-700/70 dark:bg-zinc-950/88 dark:ring-white/10`
          : "hidden"
      }
      aria-label="Voice tutor transcript"
    >
      <div className="shrink-0 border-b border-zinc-200/70 bg-gradient-to-br from-white/95 via-white/85 to-brand-blush/55 px-3 py-2.5 dark:border-zinc-800 dark:from-zinc-950/95 dark:via-zinc-950/85 dark:to-[#2a1618]/70">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-left text-[9px] font-bold uppercase tracking-[0.18em] text-brand dark:text-brand-soft">
              Voice transcript
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {aiSpeaking
                ? "Rose is speaking"
                : micActive
                  ? "Listening live"
                  : "Ready when you are"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                aiSpeaking
                  ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]"
                  : micActive
                    ? "animate-pulse bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.14)]"
                    : "bg-zinc-300 dark:bg-zinc-600"
              }`}
              title={
                aiSpeaking
                  ? "Assistant speaking"
                  : micActive
                    ? "Mic live"
                    : "Idle"
              }
              aria-hidden
            />
          </div>
          {onOpenChange ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-zinc-200/80 bg-white/75 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 shadow-sm hover:bg-white hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              Hide
            </button>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap gap-1 border-b border-zinc-100/80 bg-white/60 px-2.5 py-1.5 dark:border-zinc-800/80 dark:bg-zinc-950/50">
        {(
          [
            ["both", "Both"],
            ["user", "You"],
            ["assistant", "AI"],
            ["none", "Off"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onFilterChange(k)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              filter === k
                ? "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5 [mask-image:linear-gradient(to_bottom,transparent,black_0.5rem,black_calc(100%-0.5rem),transparent)]">
        {filter === "none" ? (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Transcript hidden — pick &quot;Both&quot;, &quot;You&quot;, or
            &quot;AI&quot; to show text again.
          </p>
        ) : null}

        {showUser ? (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              You
            </p>
            {partialUserText.trim() ? (
              <p className="mt-1 rounded-lg border border-rose-200/70 bg-rose-50/80 px-2 py-1.5 text-[11px] leading-snug text-rose-950 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-50">
                {partialUserText}
                <span className="ml-1 inline-block h-2 w-0.5 animate-pulse bg-rose-500 align-middle" />
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {micActive ? "Listening…" : "—"}
              </p>
            )}
            <ul className="mt-2 space-y-2">
              {userLines.map((line) => (
                <li
                  key={line.id}
                  className="rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <span>{formatClock(line.ts)}</span>
                    {line.interrupted ? (
                      <span className="font-semibold text-amber-700 dark:text-amber-400">
                        Interrupted
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-zinc-800 dark:text-zinc-100">
                    {line.text}
                  </p>
                  {line.bullets && line.bullets.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-zinc-600 dark:text-zinc-300">
                      {line.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showAi ? (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Assistant
            </p>
            <div className="mt-1 space-y-2">
              {aiSegments.map((seg) =>
                seg.kind === "divider" ? (
                  <div
                    key={seg.id}
                    className="flex items-center gap-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300"
                  >
                    <span className="h-px flex-1 bg-amber-200 dark:bg-amber-900/60" />
                    {seg.label ?? "Break"}
                    <span className="h-px flex-1 bg-amber-200 dark:bg-amber-900/60" />
                  </div>
                ) : (
                  <p
                    key={seg.id}
                    className="whitespace-pre-wrap rounded-lg border border-zinc-200/80 bg-white px-2 py-1.5 text-[11px] leading-snug text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100"
                  >
                    {seg.content}
                  </p>
                )
              )}
              {liveAssistantText.trim() ? (
                <p className="whitespace-pre-wrap rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-2 py-1.5 text-[11px] leading-snug text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-50">
                  {assistantHighlight &&
                  assistantHighlight.start >= 0 &&
                  assistantHighlight.end > assistantHighlight.start ? (
                    <>
                      {liveAssistantText.slice(0, assistantHighlight.start)}
                      <mark className="rounded-sm bg-emerald-200/90 px-0.5 text-emerald-950 dark:bg-emerald-800/80 dark:text-emerald-50">
                        {liveAssistantText.slice(
                          assistantHighlight.start,
                          assistantHighlight.end
                        )}
                      </mark>
                      {liveAssistantText.slice(assistantHighlight.end)}
                    </>
                  ) : (
                    liveAssistantText
                  )}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {aiSpeaking ? "Speaking…" : "—"}
                </p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
