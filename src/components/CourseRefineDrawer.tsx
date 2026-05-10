"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

const PRESETS = [
  "Remove tangents and stay tighter on the core topics from my slides.",
  "Make lessons shorter and clearer; cut repetition.",
  "Fix anything that sounds generic or off-topic compared to the rest of the course.",
  "Improve module titles and lesson flow so it reads like one coherent course.",
] as const;

type Props = {
  materialId: string;
  docked?: boolean;
};

export function CourseRefineDrawer({ materialId, docked = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async () => {
    const text = instruction.trim();
    if (text.length < 8 || loading) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/refine-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, instruction: text }),
      });
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

      setOpen(false);
      setInstruction("");
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  }, [instruction, loading, materialId, router]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            docked
              ? "min-w-[11rem] rounded-2xl border border-zinc-200/90 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-100 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
              : "fixed bottom-28 right-6 z-40 min-w-[11rem] rounded-2xl border border-zinc-200/90 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 shadow-xl shadow-zinc-900/5 ring-1 ring-zinc-100 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
          }
        >
          Refine course
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-zinc-950/50 p-0 backdrop-blur-[2px] sm:p-4 sm:pl-12"
          role="dialog"
          aria-label="Refine course with AI"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-zinc-950 sm:h-[min(520px,calc(100vh-2rem))] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl sm:ring-1 sm:ring-zinc-200/80 dark:sm:ring-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-border bg-gradient-to-r from-brand-blush/90 to-white px-5 py-4 dark:border-brand-border/40 dark:from-[#1e1616]/50 dark:to-zinc-950">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Refine with AI
                </p>
                <p className="text-[11px] text-zinc-500">
                  Describe fixes — tangents, tone, structure. Saves over your
                  current generated course. For big uploads, prefer one focused
                  change at a time (e.g. one module).
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Quick prompts
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={loading}
                    onClick={() => setInstruction(p)}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left text-xs text-zinc-700 hover:border-brand-soft hover:bg-brand-blush disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-brand-border dark:hover:bg-brand-blush/10"
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
                  rows={6}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  disabled={loading}
                  placeholder="e.g. Module 2 goes off-topic — bring it back to what’s in my slides and shorten the intro lesson."
                  className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>

            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <button
                type="button"
                disabled={loading || instruction.trim().length < 8}
                onClick={() => void apply()}
                className="w-full rounded-xl bg-brand py-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand dark:hover:bg-brand-soft"
              >
                {loading ? "Applying edits…" : "Apply & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
