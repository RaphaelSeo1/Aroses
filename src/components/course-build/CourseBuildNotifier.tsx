"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { unwatchBuild, watchedBuilds, WATCH_EVENT } from "@/lib/course-build/watch";

const POLL_MS = 8000;
const POLL_HIDDEN_MS = 20000;

type Summary = {
  id: string;
  status: string;
  courseId: string;
  materialId: string | null;
  title: string | null;
  error: string | null;
};

type Toast = { id: string; ok: boolean; title: string; href: string };

/** Tells the student when a build they started finishes, on whatever page they're on. */
export function CourseBuildNotifier() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const sync = () => setCount(watchedBuilds().length);
    sync();
    window.addEventListener(WATCH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (count === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const ids = watchedBuilds().map((w) => w.id);
      if (ids.length === 0) return;
      try {
        const res = await fetch(`/api/course-build?ids=${ids.join(",")}`, { cache: "no-store" });
        if (res.ok) {
          const { builds } = (await res.json()) as { builds: Summary[] };
          const known = new Set(builds.map((b) => b.id));
          for (const id of ids) if (!known.has(id)) unwatchBuild(id);
          for (const b of builds) {
            if (b.status !== "complete" && b.status !== "failed" && b.status !== "canceled") continue;
            unwatchBuild(b.id);
            if (b.status === "canceled") continue;
            const buildPage = `/dashboard/courses/${b.courseId}/build/${b.id}`;
            if (window.location.pathname === buildPage) continue;
            const ok = b.status === "complete";
            const title = b.title || "Your course";
            const href = ok && b.materialId ? `/dashboard/courses/${b.courseId}/study?material=${b.materialId}` : buildPage;
            setToasts((prev) => [...prev.filter((t) => t.id !== b.id), { id: b.id, ok, title, href }]);
            if (document.hidden && "Notification" in window && Notification.permission === "granted") {
              try {
                new Notification(ok ? "Your course is ready" : "Your course build stopped", {
                  body: ok ? title : b.error || title,
                  icon: "/icon.png",
                });
              } catch {
                // Notifications may need a service worker on some browsers.
              }
            }
          }
        }
      } catch {
        // Offline: try again next tick.
      }
      if (!stopped && watchedBuilds().length > 0) {
        timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
      }
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [count]);

  const visible = toasts.filter((t) => !pathname?.endsWith(`/build/${t.id}`));
  if (visible.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 print:hidden">
      {visible.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.ok ? "bg-emerald-500" : "bg-red-500"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.ok ? "Your course is ready" : "Your course build stopped"}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{t.title}</p>
            <Link
              href={t.href}
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="mt-1.5 inline-block text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              {t.ok ? "Start studying" : "See what happened"}
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
