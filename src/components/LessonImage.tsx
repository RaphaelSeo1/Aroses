"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Licensed lesson image (Wikimedia Commons) rendered inline above
 * lesson content. Lazily fetches its own data on mount via
 * `/api/study-materials/[materialId]/modules/[moduleId]/lessons/[lessonIndex]/image`
 * — the API does first-time classification + Wikimedia search +
 * cache-write, so subsequent renders return instantly.
 *
 * UX:
 *   - Shimmering skeleton while loading (~300-1500ms classifier
 *     + search on first render, instant on cache hit).
 *   - Renders nothing if the classifier said `needsImage: false`
 *     or Wikimedia had no usable match. Per spec, NEVER a broken
 *     placeholder.
 *   - Attribution required by Wikimedia Commons licensing renders
 *     in a small caption beneath, linking to the source page.
 *   - Click-to-expand opens a lightbox modal at full resolution.
 */

type LessonImagePayload = {
  url: string;
  thumbUrl: string;
  sourceUrl: string;
  attribution: string;
  type: "diagram" | "photo" | "illustration";
};

export function LessonImage({
  materialId,
  moduleId,
  lessonIndex,
  className,
  canManage = false,
}: {
  materialId: string;
  moduleId: number;
  lessonIndex: number;
  className?: string;
  /** Creator-only edit controls (replace / remove / add). */
  canManage?: boolean;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "hidden" }
    | { status: "ready"; image: LessonImagePayload }
  >({ status: "loading" });
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const imageApi = `/api/study-materials/${materialId}/modules/${moduleId}/lessons/${lessonIndex}/image`;

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch(`/api/study-materials/${materialId}/images`, {
        method: "POST",
        body: form,
      });
      const upBody = (await up.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!up.ok || !upBody.url) {
        throw new Error(upBody.error || "Upload failed.");
      }
      const res = await fetch(imageApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replace", imageUrl: upBody.url }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        image?: LessonImagePayload | null;
        error?: string;
      };
      if (!res.ok || !body.image) {
        throw new Error(body.error || "Could not save image.");
      }
      setState({ status: "ready", image: body.image });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(imageApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hide" }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "Could not remove image.");
      }
      setState({ status: "hidden" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Async fetch — the setState calls inside this IIFE are async
    // by definition (they happen AFTER an await), which is fine
    // per react-hooks/set-state-in-effect. The initial "loading"
    // state is set via useState's initial value above.
    void (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/modules/${moduleId}/lessons/${lessonIndex}/image`,
          { method: "GET" }
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "hidden" });
          return;
        }
        const body = (await res.json()) as {
          image: LessonImagePayload | null;
        };
        if (cancelled) return;
        if (!body.image) {
          setState({ status: "hidden" });
          return;
        }
        setState({ status: "ready", image: body.image });
      } catch {
        if (!cancelled) setState({ status: "hidden" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [materialId, moduleId, lessonIndex]);

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void handleUpload(f);
        e.target.value = "";
      }}
    />
  );

  if (state.status === "hidden") {
    // For non-creators we render nothing (the original behaviour). Creators
    // get an "Add image" affordance so they can attach their own image to a
    // lesson the auto-pipeline skipped or that they previously cleared.
    if (!canManage) return null;
    return (
      <div className={className ?? ""}>
        {hiddenFileInput}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-6 text-sm font-medium text-zinc-500 transition hover:border-brand hover:text-brand disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400"
        >
          {busy ? "Uploading…" : "+ Add an image to this lesson"}
        </button>
        {error ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900 ${className ?? ""}`}
        style={{ aspectRatio: "16 / 9" }}
        aria-busy="true"
        aria-label="Loading image"
      >
        <div className="absolute inset-0 animate-pulse bg-zinc-200/40 dark:bg-zinc-700/40" />
      </div>
    );
  }

  const { image } = state;
  return (
    <figure
      className={`overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50/40 dark:border-zinc-700/60 dark:bg-zinc-900/40 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full"
        aria-label="Expand image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbUrl}
          alt=""
          className="block h-auto w-full object-cover"
          loading="lazy"
        />
      </button>
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="truncate">{image.attribution}</span>
        {image.sourceUrl ? (
          <a
            href={image.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 underline-offset-2 hover:underline"
          >
            Source
          </a>
        ) : null}
      </figcaption>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200/70 px-3 py-2 dark:border-zinc-700/60">
          {hiddenFileInput}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50"
          >
            {busy ? "Working…" : "Replace image"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRemove()}
            className="text-[11px] font-semibold text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Remove image
          </button>
          {error ? (
            <span className="text-[11px] text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt=""
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-zinc-800 shadow hover:bg-white"
            aria-label="Close"
          >
            Close
          </button>
        </div>
      ) : null}
    </figure>
  );
}
