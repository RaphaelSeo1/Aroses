"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";

export default function NewCoursePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Could not create course."
        );
        setLoading(false);
        return;
      }

      const id = body.courseId as string | undefined;
      if (id) {
        router.push(`/dashboard/courses/${id}`);
        router.refresh();
      } else {
        setError("Unexpected response.");
      }
    } catch {
      setError("Network error. Try again.");
    }
    setLoading(false);
  }

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-lg px-4 py-14 sm:px-6 sm:py-20">
          <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-8 shadow-xl shadow-zinc-900/5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
              New course
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              What do you want to create?
            </h1>
            <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
              Name your course and describe what you&apos;re learning. Next,
              you&apos;ll create exam groups (Midterm 1, Final, …), then upload
              PDFs into each group — we turn each upload into lessons and
              quizzes for that exam only.
            </p>

            <form onSubmit={(e) => void onSubmit(e)} className="mt-10 space-y-6">
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Course title
            </label>
            <input
              id="title"
              name="title"
              required
              minLength={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Immunology midterm prep"
              className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 shadow-sm outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Description{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should this course cover? Who is it for?"
              className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 shadow-sm outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover disabled:opacity-60 dark:bg-brand dark:hover:bg-brand-soft sm:flex-none"
            >
              {loading ? "Creating…" : "Continue"}
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Cancel
            </Link>
          </div>
        </form>
          </div>
        </div>
      </main>
    </>
  );
}
