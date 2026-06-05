"use client";

import { useEffect, useRef, useState } from "react";
import { CourseCollaboratorsPanel } from "@/components/CourseCollaboratorsPanel";
import type { CollaboratorRole } from "@/lib/collaboration/types";

type ShareRow = {
  id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
};

type Props = {
  courseId: string;
  accent?: "brand" | "indigo";
  canManageCollaborators?: boolean;
  viewerRole?: CollaboratorRole | null;
};

type Tab = "people" | "link";

export function ShareCourseButton({
  courseId,
  accent = "brand",
  canManageCollaborators = true,
  viewerRole = "owner",
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("people");
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const baseColor =
    accent === "indigo"
      ? "border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-900/50 dark:bg-zinc-950 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900";

  const primaryColor =
    accent === "indigo"
      ? "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      : "bg-brand hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft";

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "link") return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/courses/${courseId}/share-links`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok) setShares(body.shares ?? []);
          else setError(typeof body.error === "string" ? body.error : "Could not load links.");
        }
      } catch {
        if (!cancelled) setError("Network error.");
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, tab, courseId]);

  async function createLink() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/share-links`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create link.");
        setCreating(false);
        return;
      }
      const newShare = body.share as ShareRow;
      setShares((prev) => [newShare, ...prev]);
      const url = shareUrlFor(newShare.token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(newShare.id);
        setTimeout(() => setCopiedId((c) => (c === newShare.id ? null : c)), 1800);
      } catch {
        /* clipboard may be denied */
      }
    } catch {
      setError("Network error.");
    }
    setCreating(false);
  }

  async function revoke(id: string) {
    setError(null);
    setShares((prev) => prev.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/courses/${courseId}/share-links/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) setError("Could not revoke link.");
    } catch {
      setError("Network error.");
    }
  }

  function shareUrlFor(token: string): string {
    if (typeof window === "undefined") return `/share/${token}`;
    return `${window.location.origin}/share/${token}`;
  }

  async function copyToClipboard(s: ShareRow) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(s.token));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 1800);
    } catch {
      setError("Clipboard blocked — long-press the link to copy.");
    }
  }

  const buttonLabel = canManageCollaborators ? "Add people" : "People";

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={canManageCollaborators ? "Add people to this course" : "View course collaborators"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition ${baseColor}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {buttonLabel}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setTab("people")}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === "people"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
              }`}
            >
              People
            </button>
            <button
              type="button"
              onClick={() => setTab("link")}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === "link"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
              }`}
            >
              Public link
            </button>
          </div>

          <div className="mt-4">
            {tab === "people" ? (
              <CourseCollaboratorsPanel
                courseId={courseId}
                canManage={canManageCollaborators}
                viewerRole={viewerRole}
                accent={accent}
              />
            ) : (
              <>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Share with a link
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Anyone with the link can view this course (read-only). They don&apos;t
                  need an account. Revoke any link any time.
                </p>

                {error && (
                  <p className="mt-3 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
                    {error}
                  </p>
                )}

                <div className="mt-3 space-y-2">
                  {loading ? (
                    <p className="py-3 text-center text-xs text-zinc-400">Loading…</p>
                  ) : shares.length === 0 ? (
                    <p className="py-2 text-center text-xs text-zinc-400">No share links yet.</p>
                  ) : (
                    shares.map((s) => {
                      const url = shareUrlFor(s.token);
                      const isCopied = copiedId === s.id;
                      return (
                        <div
                          key={s.id}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <div className="flex items-center gap-1.5">
                            <p
                              className="flex-1 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400"
                              title={url}
                            >
                              {url.replace(/^https?:\/\//, "")}
                            </p>
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(s)}
                              className="rounded-md bg-zinc-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                              {isCopied ? "Copied" : "Copy"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void revoke(s.id)}
                              title="Revoke this link"
                              className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            >
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                                <path d="M7 4a1 1 0 011-1h4a1 1 0 011 1v1h3a1 1 0 110 2h-1.07l-.66 9.27A2 2 0 0114.28 18H5.72a2 2 0 01-1.99-1.73L3.07 7H2a1 1 0 110-2h3V4zm2 0v1h2V4H9zm-3 5a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-2 0V9H7v6a1 1 0 01-2 0V9z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {canManageCollaborators ? (
                  <button
                    type="button"
                    onClick={() => void createLink()}
                    disabled={creating}
                    className={`mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 ${primaryColor}`}
                  >
                    {creating ? "Creating…" : "+ Create new link"}
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    Only the course owner can create public share links.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
