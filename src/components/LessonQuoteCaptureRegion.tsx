"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export const LESSON_QUOTE_EVENT = "aroses-lesson-quote";

export type LessonQuoteDetail = {
  lessonIndex: number;
  text: string;
};

const MIN_CHARS = 2;

function captureSelection(root: HTMLElement, lessonIndex: number) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const text = sel.toString().replace(/\u00a0/g, " ").trim();
  if (text.length < MIN_CHARS) return;

  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  if (!el || !root.contains(el)) return;

  window.dispatchEvent(
    new CustomEvent<LessonQuoteDetail>(LESSON_QUOTE_EVENT, {
      detail: { lessonIndex, text },
    })
  );

  sel.removeAllRanges();
}

/**
 * Wraps lesson bodies in read mode; selected text is sent to {@link LESSON_QUOTE_EVENT}
 * for the matching lesson’s notes panel.
 */
export function LessonQuoteCaptureRegion({
  lessonIndex,
  enabled = true,
  className,
  children,
}: {
  lessonIndex: number;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;

    const onMouseUp = () => captureSelection(root, lessonIndex);

    const onTouchEnd = () => {
      window.setTimeout(() => captureSelection(root, lessonIndex), 50);
    };

    root.addEventListener("mouseup", onMouseUp);
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener("mouseup", onMouseUp);
      root.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, lessonIndex]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
