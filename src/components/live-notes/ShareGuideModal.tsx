"use client";

import type { LiveCaptureSource } from "@/lib/live-notes/capture";

/**
 * Aroses-branded step before Chrome's getDisplayMedia picker.
 * The browser picker itself cannot be restyled (security UI).
 */
export function ShareGuideModal({
  source,
  onContinue,
  onCancel,
  busy,
}: {
  source: LiveCaptureSource;
  onContinue: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const isMic = source === "mic";
  const isSystem = source === "system";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-guide-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        <div className="border-b border-rose-100 bg-gradient-to-br from-rose-50 to-white px-6 py-5 dark:border-rose-950/40 dark:from-rose-950/40 dark:to-zinc-950">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">
            Aroses · Live notes
          </p>
          <h2
            id="share-guide-title"
            className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            {isMic
              ? "Allow microphone access"
              : isSystem
                ? "Share your screen with Rose"
                : "Share your lecture tab with Rose"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {isMic
              ? "Next you’ll see a quick browser permission — tap Allow so Rose can hear the lecture. Unplug headphones if you can: headset mics ignore the room, even when you can hear the speaker clearly."
              : "Rose will open your browser’s share picker next (required for privacy). Here’s exactly what to choose."}
          </p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {isMic ? (
            <Step n={1}>
              Click <strong>Allow</strong> when Chrome asks for the microphone.
            </Step>
          ) : (
            <>
              <Step n={1}>
                In the share window, open the{" "}
                <strong>{isSystem ? "Entire Screen" : "Chrome Tab"}</strong> pane.
              </Step>
              <Step n={2}>
                {isSystem ? (
                  <>
                    Select your screen and turn on{" "}
                    <strong>Also share system audio</strong>.
                  </>
                ) : (
                  <>
                    Select the <strong>lecture tab</strong> (YouTube, Zoom,
                    slides…) — <em>not</em> this Aroses tab.
                  </>
                )}
              </Step>
              {!isSystem ? (
                <Step n={3}>
                  Turn on <strong>Also share tab audio</strong>, then click{" "}
                  <strong>Share</strong>.
                </Step>
              ) : (
                <Step n={3}>
                  Click <strong>Share</strong>.
                </Step>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
          >
            {busy ? "Opening…" : "Continue with Rose"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
        {n}
      </span>
      <p className="pt-0.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </p>
    </div>
  );
}
