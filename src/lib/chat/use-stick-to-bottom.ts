"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

const NEAR_BOTTOM_PX = 80;

/**
 * Auto-scroll a transcript to the latest message, but only while the user is
 * already pinned near the bottom. Scrolling up pauses stick-to-bottom so they
 * can read earlier turns while a reply is still typing.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  {
    active = true,
    resetKey,
  }: {
    active?: boolean;
    /** When this changes (new send, thread switch), re-pin to the bottom. */
    resetKey?: string | number | boolean | null;
  }
): { pin: () => void } {
  const pinnedRef = useRef(true);

  const stickIfPinned = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  const pin = useCallback(() => {
    pinnedRef.current = true;
    stickIfPinned();
  }, [stickIfPinned]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = dist <= NEAR_BOTTOM_PX;
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (!active) return;
    stickIfPinned();
  }, [active, resetKey, stickIfPinned]);

  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    const stick = () => stickIfPinned();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(stick) : null;
    ro?.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    const mo = new MutationObserver(stick);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      mo.disconnect();
    };
  }, [active, onScroll, resetKey, stickIfPinned]);

  return { pin };
}
