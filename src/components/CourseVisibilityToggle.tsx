"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CourseVisibilityToggle({
  courseId,
  initialPublic,
}: {
  courseId: string;
  initialPublic: boolean;
}) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.error === "string" ? body.error : "Could not update."
        );
        setPending(false);
        return;
      }
      setIsPublic(next);
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setPending(false);
  }

  return (
    <div className="rounded-2xl border border-zinc-200/90 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Public Explore listing
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Opening the Explore page never publishes your courses — only this switch
        does. Let anyone browse your{" "}
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          course title and description
        </span>{" "}
        on the community Explore page. Your PDFs and generated lessons stay on
        your account unless you share study links yourself.
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isPublic}
          disabled={pending}
          onChange={(e) => void apply(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-zinc-300 text-brand focus:ring-brand dark:border-zinc-600"
        />
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Show this course on Explore
        </span>
      </label>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
