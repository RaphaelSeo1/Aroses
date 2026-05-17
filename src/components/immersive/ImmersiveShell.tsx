"use client";

import type { ReactNode } from "react";
import { CloudBackground } from "@/components/immersive/CloudBackground";

/**
 * Root container for the immersive Mentored Learning view.
 *
 * Renders the cloud background, an optional top bar slot, the main content
 * area (anything passed as children), and a fixed bottom region for the
 * waveform / answer composer. Everything is positioned so the page itself
 * doesn't scroll; the inner content area scrolls if it overflows.
 *
 * The shell is intentionally chrome-free — no global header, no sidebar.
 * Callers pass their own `topBar` (subtle, top-right exit/switch buttons)
 * and `bottomBar` (waveform + composer cluster).
 */
export function ImmersiveShell({
  topBar,
  children,
  bottomBar,
}: {
  topBar?: ReactNode;
  children: ReactNode;
  bottomBar?: ReactNode;
}) {
  return (
    <div className="immersive-root fixed inset-0 flex flex-col overflow-hidden text-zinc-900">
      <CloudBackground />

      {topBar ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="pointer-events-auto">{/* left slot reserved */}</div>
          <div className="pointer-events-auto ml-auto">{topBar}</div>
        </div>
      ) : null}

      <main className="immersive-main relative z-0 flex flex-1 flex-col items-center overflow-y-auto px-4 pb-[clamp(180px,22vh,260px)] pt-20 sm:px-6 sm:pt-24">
        <div className="immersive-fade-in w-full max-w-3xl">{children}</div>
      </main>

      {bottomBar ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-4 pb-6 sm:px-6">
          <div className="pointer-events-auto w-full max-w-3xl">
            {bottomBar}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .immersive-fade-in {
          animation: imm-shell-in 0.7s ease-out both;
        }
        @keyframes imm-shell-in {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .immersive-fade-in {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
