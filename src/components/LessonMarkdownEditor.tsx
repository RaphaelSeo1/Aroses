"use client";

import { useCallback, useRef, useState } from "react";

function insertAtCursor(
  el: HTMLTextAreaElement,
  value: string,
  insert: string
): string {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  return value.slice(0, start) + insert + value.slice(end);
}

type Props = {
  materialId: string;
  lessonIndex: number;
  draft: string;
  onDraftChange: (next: string) => void;
  disabled?: boolean;
};

/** Markdown body editor with image upload (same bucket API as before). */
export function LessonMarkdownEditor({
  materialId,
  lessonIndex,
  draft,
  onDraftChange,
  disabled = false,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (uploading || disabled) return;
      if (!file.type.startsWith("image/")) {
        setError("Please choose an image file.");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch(
          `/api/study-materials/${materialId}/images`,
          { method: "POST", body: fd }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body.error === "string" ? body.error : "Upload failed."
          );
          setUploading(false);
          return;
        }
        const url = body.url as string | undefined;
        if (!url) {
          setError("No image URL returned.");
          setUploading(false);
          return;
        }
        const line = `\n\n![image](${url})\n\n`;
        const el = taRef.current;
        onDraftChange(
          el ? insertAtCursor(el, draft, line) : draft + line
        );
        requestAnimationFrame(() => {
          const t = taRef.current;
          if (t) {
            t.focus();
            const pos = t.value.length;
            t.setSelectionRange(pos, pos);
          }
        });
      } catch {
        setError("Upload failed.");
      }
      setUploading(false);
    },
    [draft, disabled, materialId, onDraftChange, uploading]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      const f = e.dataTransfer.files?.[0];
      if (f) void uploadFile(f);
    },
    [disabled, uploadFile]
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Markdown & KaTeX — drag images below. Inline{" "}
        <code className="rounded bg-white px-1 dark:bg-zinc-950">$x^2$</code>
        , display{" "}
        <code className="rounded bg-white px-1 dark:bg-zinc-950">$$ … $$</code>
        .
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-white dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          onClick={() =>
            onDraftChange(
              (() => {
                const el = taRef.current;
                const ins = "\n\n$$ \n\n $$\n\n";
                return el ? insertAtCursor(el, draft, ins) : draft + ins;
              })()
            )
          }
          disabled={disabled}
        >
          Insert equation block
        </button>
        <button
          type="button"
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-white dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || disabled}
        >
          {uploading ? "Uploading…" : "Add image"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadFile(f);
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={onDrop}
      >
        <label
          className="sr-only"
          htmlFor={`lesson-md-${materialId}-${lessonIndex}`}
        >
          Lesson body
        </label>
        <textarea
          ref={taRef}
          id={`lesson-md-${materialId}-${lessonIndex}`}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          disabled={disabled}
          rows={14}
          className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          spellCheck
        />
      </div>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
