"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * On-brand replacement for the browser's native window.confirm / alert / prompt
 * (which render as "aroses.app says …" Chrome dialogs).
 *
 * Usage from anywhere (no context/provider wiring needed at the call site):
 *   if (await confirmDialog({ title: "Delete course?", body: "…", tone: "danger" })) { … }
 *   await alertDialog({ title: "Couldn't save", body: msg });
 *   const url = await promptDialog({ title: "Add link", label: "URL" });
 *
 * Mount <AppDialogs /> once near the root (see app/layout.tsx).
 */

type Tone = "default" | "danger";

type ConfirmRequest = {
  kind: "confirm";
  id: number;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  resolve: (value: boolean) => void;
};

type AlertRequest = {
  kind: "alert";
  id: number;
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: Tone;
  resolve: (value: void) => void;
};

type PromptRequest = {
  kind: "prompt";
  id: number;
  title: string;
  body?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: string | null) => void;
};

type DialogRequest = ConfirmRequest | AlertRequest | PromptRequest;

const listeners = new Set<() => void>();
const pending: DialogRequest[] = [];
let active: DialogRequest | null = null;
let counter = 0;

function emit() {
  for (const l of listeners) l();
}

function advance() {
  if (active == null && pending.length > 0) {
    active = pending.shift() ?? null;
    emit();
  }
}

function enqueue(req: DialogRequest) {
  pending.push(req);
  advance();
}

function closeActive() {
  active = null;
  emit();
  advance();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DialogRequest | null {
  return active;
}

export function confirmDialog(opts: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ kind: "confirm", id: ++counter, resolve, ...opts });
  });
}

export function alertDialog(opts: {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: Tone;
}): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ kind: "alert", id: ++counter, resolve, ...opts });
  });
}

export function promptDialog(opts: {
  title: string;
  body?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({ kind: "prompt", id: ++counter, resolve, ...opts });
  });
}

const overlayClass =
  "fixed inset-0 z-[200] flex items-center justify-center p-4";
const cardClass =
  "relative z-10 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950";
const titleClass = "text-lg font-semibold text-zinc-900 dark:text-zinc-50";
const bodyClass =
  "mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300";
const cancelBtnClass =
  "rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

function confirmBtnClass(tone: Tone): string {
  if (tone === "danger") {
    return "rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700";
  }
  return "rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover";
}

function DialogShell({
  request,
  onDone,
}: {
  request: DialogRequest;
  onDone: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(
    request.kind === "prompt" ? (request.defaultValue ?? "") : ""
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (request.kind === "prompt") {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [request.kind]);

  const finish = (action: "confirm" | "cancel") => {
    if (request.kind === "confirm") {
      request.resolve(action === "confirm");
    } else if (request.kind === "alert") {
      request.resolve();
    } else {
      request.resolve(action === "confirm" ? value : null);
    }
    onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish("cancel");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const tone: Tone =
    "tone" in request && request.tone ? request.tone : "default";
  const showCancel = request.kind !== "alert";
  const confirmLabel =
    request.kind === "alert"
      ? (request.confirmLabel ?? t.common.ok)
      : (request.confirmLabel ??
        (request.kind === "confirm" ? t.common.confirm : t.common.saveLabel));
  const cancelLabel =
    request.kind === "alert" ? "" : (request.cancelLabel ?? t.common.cancel);

  return (
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={() => finish("cancel")}
        aria-label={t.common.dismiss}
      />
      <div className={cardClass}>
        <h2 className={titleClass}>{request.title}</h2>
        {request.body ? <p className={bodyClass}>{request.body}</p> : null}

        {request.kind === "prompt" ? (
          <div className="mt-4">
            {request.label ? (
              <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {request.label}
              </label>
            ) : null}
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finish("confirm");
                }
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {showCancel ? (
            <button
              type="button"
              onClick={() => finish("cancel")}
              className={cancelBtnClass}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            autoFocus={request.kind !== "prompt"}
            onClick={() => finish("confirm")}
            className={confirmBtnClass(tone)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppDialogs() {
  const request = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!request) return null;
  return (
    <DialogShell key={request.id} request={request} onDone={closeActive} />
  );
}
