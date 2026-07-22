"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SchoolNameAutocomplete } from "@/components/SchoolNameAutocomplete";

function SchoolLabelSwitch({
  checked,
  disabled,
  onChange,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-8 w-[3.25rem] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-emerald-500 dark:bg-emerald-500"
          : "bg-zinc-300 dark:bg-zinc-600",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out",
          checked ? "translate-x-[1.35rem]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

/**
 * Optional school tag + show/hide on Explore.
 * Empty tag = Explore falls back to the creator's profile school (when shown).
 */
export function CourseSchoolTagField({
  courseId,
  initialSchoolName,
  initialShowSchoolLabel = true,
}: {
  courseId: string;
  initialSchoolName: string | null;
  initialShowSchoolLabel?: boolean;
}) {
  const router = useRouter();
  const [schoolName, setSchoolName] = useState(initialSchoolName ?? "");
  const [showSchoolLabel, setShowSchoolLabel] = useState(initialShowSchoolLabel);
  const [pending, setPending] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const switchId = `course-show-school-${courseId}`;

  async function saveTag() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolName: schoolName.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.error === "string" ? body.error : "Could not save school."
        );
        setPending(false);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setPending(false);
  }

  async function applyShowLabel(next: boolean) {
    setTogglePending(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showSchoolLabel: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.error === "string" ? body.error : "Could not update."
        );
        setTogglePending(false);
        return;
      }
      setShowSchoolLabel(next);
      router.refresh();
    } catch {
      setError("Network error.");
    }
    setTogglePending(false);
  }

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200/90 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        School on Explore
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Control whether Explore shows a school chip for this course. When on
        and no tag is set, it uses your profile school.
      </p>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="min-w-0">
          <label
            htmlFor={switchId}
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Show school label
          </label>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {showSchoolLabel
              ? "Visible on Explore cards and in My school."
              : "Hidden — no school chip for this course."}
          </p>
        </div>
        <SchoolLabelSwitch
          id={switchId}
          checked={showSchoolLabel}
          disabled={togglePending}
          onChange={(next) => void applyShowLabel(next)}
        />
      </div>

      <div
        className={`mt-4 ${showSchoolLabel ? "" : "pointer-events-none opacity-50"}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Optional override
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Leave blank to use your profile school. Set a tag to show a different
          school on this course only.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <SchoolNameAutocomplete
              id={`course-school-${courseId}`}
              value={schoolName}
              onChange={(v) => {
                setSchoolName(v);
                setSaved(false);
              }}
              placeholder="e.g. University of Michigan"
              disabled={pending || !showSchoolLabel}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
          <button
            type="button"
            disabled={pending || !showSchoolLabel}
            onClick={() => void saveTag()}
            className="shrink-0 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {saved ? (
          <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Saved.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
