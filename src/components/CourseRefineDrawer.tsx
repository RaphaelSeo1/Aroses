"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import {
  AROSES_COURSE_REFINED_EVENT,
  type ArosesCourseRefinedDetail,
} from "@/lib/refine-course-events";

const PRESETS = [
  "Remove all images from every module and lesson.",
  "Shorten module 1 — make every lesson clearer and cut repetition.",
  "Remove tangents and stay tighter on the core topics from my slides.",
  "Fix module titles and lesson flow so it reads like one coherent course.",
  "Rewrite the quizzes in module 2 to match the lessons more closely.",
] as const;

/** Rotating copy in the same spirit as PDF build / module writing (no raw JSON). */
const REFINE_TRANSITION_LINES = [
  "Re-reading your modules and lessons so edits stay on-topic…",
  "Adjusting tone, length, and flow to match what you asked for…",
  "Large courses take longer — the page will update as soon as the save finishes.",
  "You can leave this drawer open; the timer shows the request is still running.",
] as const;

type Props = {
  materialId: string;
  docked?: boolean;
};

function formatElapsedShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m ${rs}s` : `${m} min`;
}

function parseNdjsonBuffer(
  buffer: string
): { lines: unknown[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines: unknown[] = [];
  for (const line of parts) {
    const t = line.trim();
    if (!t) continue;
    try {
      lines.push(JSON.parse(t) as unknown);
    } catch {
      /* skip malformed chunk */
    }
  }
  return { lines, rest };
}

export function CourseRefineDrawer({ materialId, docked = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rotateIndex, setRotateIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    }, 100);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!loading) {
      startedAtRef.current = null;
      setElapsedMs(0);
      return;
    }
    startedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      const t0 = startedAtRef.current;
      if (t0 == null) return;
      setElapsedMs(Date.now() - t0);
    }, 500);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setRotateIndex((i) => (i + 1) % REFINE_TRANSITION_LINES.length);
    }, 9_000);
    return () => window.clearInterval(id);
  }, [loading]);

  const apply = useCallback(async () => {
    const text = instruction.trim();
    if (text.length < 8 || loading) return;

    setError(null);
    setLoading(true);
    setPhaseMessage(null);
    setRotateIndex(0);

    try {
      const res = await fetch("/api/refine-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, instruction: text, stream: true }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (ct.includes("ndjson") && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let sawDone = false;

        while (true) {
          const { done, value } = await reader.read();
          if (value) buf += dec.decode(value, { stream: true });
          const { lines, rest } = parseNdjsonBuffer(buf);
          buf = rest;

          for (const row of lines) {
            if (!row || typeof row !== "object") continue;
            const r = row as {
              type?: string;
              message?: string;
              applied?: string[];
            };
            if (r.type === "phase" && typeof r.message === "string") {
              setPhaseMessage(r.message);
            } else if (r.type === "error" && typeof r.message === "string") {
              setError(r.message);
              setLoading(false);
              return;
            } else if (r.type === "done") {
              sawDone = true;
              if (Array.isArray(r.applied) && r.applied.length > 0) {
                setPhaseMessage(r.applied.join(" "));
              }
            }
          }

          if (done) break;
        }

        if (buf.trim()) {
          const { lines } = parseNdjsonBuffer(buf + "\n");
          for (const row of lines) {
            if (!row || typeof row !== "object") continue;
            const r = row as { type?: string; message?: string };
            if (r.type === "error" && typeof r.message === "string") {
              setError(r.message);
              setLoading(false);
              return;
            }
            if (r.type === "done") sawDone = true;
          }
        }

        if (!res.ok) {
          setError("Could not apply edits.");
          setLoading(false);
          return;
        }

        if (!sawDone) {
          setError("No completion signal from the server.");
          setLoading(false);
          return;
        }

        const detail: ArosesCourseRefinedDetail = { materialId };
        window.dispatchEvent(
          new CustomEvent(AROSES_COURSE_REFINED_EVENT, { detail })
        );
        setOpen(false);
        setInstruction("");
        setPhaseMessage(null);
        setLoading(false);
        return;
      }

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Could not apply edits."
        );
        setLoading(false);
        return;
      }

      if (body.ok === true) {
        window.dispatchEvent(
          new CustomEvent(AROSES_COURSE_REFINED_EVENT, {
            detail: { materialId } satisfies ArosesCourseRefinedDetail,
          })
        );
      } else {
        router.refresh();
      }

      setOpen(false);
      setInstruction("");
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }, [instruction, loading, materialId, router]);

  const elapsedPart =
    elapsedMs > 0 ? ` · ${formatElapsedShort(elapsedMs)}` : "";
  const primaryLine = phaseMessage
    ? `${phaseMessage}${elapsedPart}`
    : `Step 1/2: Revising your course with AI…${elapsedPart}`;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "min-w-[11rem] rounded-2xl border border-brand/35 bg-white px-5 py-3 text-sm font-semibold text-brand shadow-xl shadow-red-600/10 ring-1 ring-brand/10 transition hover:border-brand/55 hover:bg-brand-blush/90 dark:border-brand-border/50 dark:bg-zinc-900 dark:text-brand-soft dark:ring-brand-border/30 dark:hover:bg-brand-blush/15"
              : "fixed bottom-28 right-6 z-[100] min-w-[11rem] rounded-2xl border border-brand/35 bg-white px-5 py-3 text-sm font-semibold text-brand shadow-xl shadow-red-600/10 ring-1 ring-brand/10 hover:border-brand/55 hover:bg-brand-blush/90 dark:border-brand-border/50 dark:bg-zinc-900 dark:text-brand-soft dark:ring-brand-border/30 dark:hover:bg-brand-blush/15"
          }
        >
          Refine with {AI_ASSISTANT_NAME}
        </button>
      )}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={`Refine course with ${AI_ASSISTANT_NAME}`}
          className="fixed top-14 right-0 z-[100] flex h-[calc(100vh-3.5rem)] w-[min(100vw-12px,22rem)] flex-col border-l border-zinc-200/95 bg-white dark:border-zinc-700 dark:bg-zinc-950 sm:top-16 sm:h-[calc(100vh-4rem)] sm:w-[min(100vw-16px,26rem)]"
          style={{
            boxShadow:
              "-12px 0 40px -12px rgba(0,0,0,0.12), -4px 0 16px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-gradient-to-r from-brand-blush/90 to-white px-4 py-3 dark:border-brand-border/40 dark:from-[#1e1616]/40 dark:to-zinc-950 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Refine with {AI_ASSISTANT_NAME}
              </p>
              <p className="text-[11px] leading-snug text-zinc-500">
                Describe edits in plain language — bulk changes (remove all
                images), one module (&ldquo;module 2&rdquo;), or the whole
                course. Rose parses your intent, applies reliable bulk edits
                instantly, and uses AI for rewrites.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Quick prompts
            </p>
            <div className="flex flex-col gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={loading}
                  onClick={() => setInstruction(p)}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left text-xs leading-snug text-zinc-700 hover:border-brand-soft hover:bg-brand-blush disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-brand-border dark:hover:bg-brand-blush/10"
                >
                  {p}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Your edit request
              </span>
              <textarea
                rows={5}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={loading}
                placeholder="e.g. Shorten module 2, remove all images, or fix quiz questions in module 1."
                className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>

            {loading ? (
              <div
                className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Applying your edit
                </p>
                <p className="mt-1.5 whitespace-pre-line text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {primaryLine}
                </p>
                <p className="mt-2 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  {REFINE_TRANSITION_LINES[rotateIndex]}
                </p>
                <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="absolute inset-y-0 w-[32%] rounded-full bg-brand shadow-sm shadow-red-500/20 dark:bg-brand-soft dark:shadow-red-900/30 animate-course-upload-indeterminate"
                    aria-hidden
                  />
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              disabled={loading || instruction.trim().length < 8}
              onClick={() => void apply()}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-brand-hover disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
            >
              {loading ? "Working…" : "Apply & save"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
