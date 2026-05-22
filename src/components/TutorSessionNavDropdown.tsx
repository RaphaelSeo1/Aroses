"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HEADER_NAV_ACCENT,
  HEADER_NAV_NEUTRAL,
} from "@/components/AppHeader";
import type { TutorSessionSummary } from "@/types/tutor-session";

/**
 * Header-nav entry for Tutor Sessions.
 *
 * Behaves like the regular Tutor Session nav link (click to land on
 * the start screen), but with a chevron that opens a dropdown listing
 * recent sessions. From the dropdown the student can:
 *   - Start a brand-new session
 *   - Re-open any of their recent sessions (routes to the recap)
 *   - Click "View all sessions →" to land on the library at /sessions
 *
 * Sessions are fetched lazily — the first time the dropdown opens we
 * hit /api/tutor-sessions, then cache for the rest of the session.
 * Closes on outside click, escape, or route change.
 */
export function TutorSessionNavDropdown() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<TutorSessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const active =
    pathname === "/tutor-session" ||
    pathname.startsWith("/tutor-session/") ||
    pathname.startsWith("/sessions");

  // Fetch on first open.
  const fetchSessions = useCallback(async () => {
    if (sessions !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tutor-sessions?limit=8");
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = (await res.json()) as { sessions: TutorSessionSummary[] };
      setSessions(body.sessions ?? []);
    } catch (e) {
      console.error("[TutorSessionNavDropdown]", e);
      setError("Couldn't load sessions.");
    } finally {
      setLoading(false);
    }
  }, [loading, sessions]);

  // Open / close handlers.
  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next) void fetchSessions();
      return next;
    });
  }, [fetchSessions]);
  const close = useCallback(() => setOpen(false), []);

  // Close on outside click + escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when the route changes (e.g. user clicked a dropdown link).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="inline-flex items-center gap-1">
        <Link
          href="/tutor-session"
          prefetch
          className={`${
            active ? HEADER_NAV_ACCENT : HEADER_NAV_NEUTRAL
          } inline-flex items-center gap-1.5`}
          title="Open a one-on-one tutor session with Rose"
          aria-current={active ? "page" : undefined}
        >
          <svg
            className="h-4 w-4 shrink-0 opacity-80"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span>Tutor Session</span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Browse past tutor sessions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-brand-muted transition hover:bg-brand-blush hover:text-brand-ink dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {open ? (
        <div
          role="menu"
          aria-label="Tutor sessions"
          className="absolute left-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_40px_-12px_rgba(60,60,90,0.18)] ring-1 ring-zinc-900/[0.04]"
        >
          <div className="border-b border-zinc-100 px-3 py-2">
            <Link
              href="/tutor-session"
              onClick={close}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 px-3 py-2 text-sm font-semibold text-violet-800 transition hover:from-violet-100 hover:to-fuchsia-100"
            >
              <span
                aria-hidden
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-base shadow-sm ring-1 ring-violet-200"
              >
                ✨
              </span>
              <span>Start a new session</span>
            </Link>
          </div>

          <div className="max-h-[360px] overflow-y-auto px-2 py-2">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Recent sessions
            </p>
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-zinc-500">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
                </svg>
                Loading…
              </div>
            ) : error ? (
              <p className="px-3 py-3 text-xs text-rose-600">{error}</p>
            ) : !sessions || sessions.length === 0 ? (
              <p className="px-3 py-3 text-xs text-zinc-500">
                No sessions yet. Start your first one above.
              </p>
            ) : (
              <ul className="flex flex-col">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={
                        s.status === "ended"
                          ? `/tutor-session/recap/${s.id}`
                          : `/tutor-session/${s.id}`
                      }
                      onClick={close}
                      className="flex flex-col gap-0.5 rounded-xl px-3 py-2 transition hover:bg-zinc-50"
                    >
                      <span className="line-clamp-1 text-[13px] font-medium text-zinc-900">
                        {s.title || s.topic || "Untitled session"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                        {s.modeTag ? (
                          <span>{s.modeTag.replace(/_/g, " ")}</span>
                        ) : null}
                        {s.modeTag ? <span aria-hidden>·</span> : null}
                        <span>
                          {new Date(s.startedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        {s.status === "active" ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="text-emerald-600">Active</span>
                          </>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-zinc-100 px-2 py-1.5">
            <Link
              href="/sessions"
              onClick={close}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <span>View all sessions</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
