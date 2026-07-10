"use client";

import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type EmojiSelectPayload = {
  native?: string;
};

/**
 * Button that opens the full emoji-mart picker (search + complete Unicode set).
 * Picker is portaled to document.body so it isn't clipped by sidebar/preview stacking.
 */
export function EmojiPickerButton({
  value,
  onChange,
  ariaLabel = "Choose emoji",
  className,
  size = "md",
}: {
  value: string;
  onChange: (emoji: string) => void;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 352;
      const gap = 8;
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - panelWidth - 8
      );
      const top = rect.bottom + gap;
      setPos({ top, left });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const btnSize =
    size === "sm"
      ? "h-8 w-8 rounded-lg text-base"
      : "h-12 w-12 rounded-2xl text-3xl";

  const picker =
    open && mounted && pos
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[200] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Picker
              data={data}
              theme="auto"
              previewPosition="none"
              skinTonePosition="search"
              onEmojiSelect={(emoji: EmojiSelectPayload) => {
                const native = emoji?.native?.trim();
                if (!native) return;
                onChange(native);
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={
          className ??
          `inline-flex items-center justify-center border border-zinc-200/80 bg-white leading-none shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 ${btnSize}`
        }
        aria-label={ariaLabel}
        aria-expanded={open}
        title="Choose emoji"
      >
        {value || "📝"}
      </button>
      {picker}
    </>
  );
}
