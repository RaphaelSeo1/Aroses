/** Builds this browser started, so any page can say when one finishes. */

const KEY = "aroses:course-builds";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const WATCH_EVENT = "aroses:course-builds-changed";

type Watched = { id: string; courseId: string; at: number };

function read(): Watched[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Watched[];
    const now = Date.now();
    return Array.isArray(raw) ? raw.filter((w) => w && typeof w.id === "string" && now - w.at < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

function write(list: Watched[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
    window.dispatchEvent(new Event(WATCH_EVENT));
  } catch {
    // Private mode or full storage: notifications just won't show.
  }
}

export function watchedBuilds(): Watched[] {
  return read();
}

export function watchBuild(id: string, courseId: string) {
  write([...read().filter((w) => w.id !== id), { id, courseId, at: Date.now() }]);
}

export function unwatchBuild(id: string) {
  write(read().filter((w) => w.id !== id));
}
