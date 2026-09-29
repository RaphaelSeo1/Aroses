"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { countFilePages, textPages } from "@/lib/course-build/client-page-count";
import { BUILD_LANGUAGE_OPTIONS, MATCH_MY_FILES } from "@/lib/course-build/language";
import {
  addSingles,
  buildRequests,
  combineWith,
  defaultUnitName,
  isGroup,
  moveSource,
  nudgeSource,
  removeSource,
  renameUnit,
  separateSource,
  sourceName,
  ungroup,
  unitOf,
  unitPages,
  unitTitle,
  type PageCount,
  type UploadSource,
  type UploadUnit,
} from "@/lib/course-build/upload-groups";
import { watchBuild } from "@/lib/course-build/watch";
import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { detectIngestFormat, extensionOfFileName, maxBytesForKind } from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { createClient } from "@/lib/supabase/client";

export type BuilderCourse = { id: string; title: string; sections: Array<{ id: string; name: string }> };
export type BuilderPrefill = { kind: "note" | "live_session" | "tutor_session"; id: string; label: string };
export type BuilderLimits = {
  pagesUsed: number;
  pagesCap: number | null;
  periodEnd: string | null;
};

type Props = {
  userId: string;
  enabled: boolean;
  courses: BuilderCourse[];
  initialCourseId: string | null;
  initialSectionId: string | null;
  prefill: BuilderPrefill | null;
  limits: BuilderLimits;
};

/** A source on the screen: what the build gets, the file to upload, and its badge. */
type Entry = { source: UploadSource; file: File | null; badge: string; detail: string | null };

type DropTarget =
  | { kind: "source"; key: string; place: "before" | "after" }
  | { kind: "unit"; unitId: string }
  | { kind: "separate" };

type DragView = { key: string; x: number; y: number; active: boolean };

const ACCEPT = ".pdf,.pptx,.docx,.txt,.md,.markdown,.rtf,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm";
const MAX_FILES = 20;
const MAX_TEXTS = 5;
const MAX_LINKS = 5;
const PREFILL_NOUN: Record<BuilderPrefill["kind"], string> = {
  note: "Note",
  live_session: "Live lecture notes",
  tutor_session: "Tutor session",
};

function kindLabel(name: string): string | null {
  const ext = extensionOfFileName(name);
  const kind = detectIngestFormat(name);
  if (kind === "pdf") return "PDF";
  if (kind === "slides" && ext === "pptx") return "Slides";
  if (kind === "word" && ext === "docx") return "Word";
  if (kind === "text" || kind === "markdown" || kind === "rtf") return "Text";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  return null;
}

function fileProblem(file: File): string | null {
  const ext = extensionOfFileName(file.name);
  if (ext === "doc" || ext === "ppt") return `${file.name} is an old Office format. Save it as .${ext}x first.`;
  const kind = detectIngestFormat(file.name, file.type);
  if (kind === "image") return `${file.name} is an image. Images can't be built into a course yet.`;
  if (!kind || !kindLabel(file.name)) return `${file.name} isn't a file type the builder can read.`;
  const max = maxBytesForKind(kind);
  if (file.size > max) return `${file.name} is too large. The limit for this kind of file is ${Math.round(max / 1048576)} MB.`;
  return null;
}

function remaining(used: number, cap: number | null): number | null {
  return cap == null ? null : Math.max(0, cap - used);
}

function resetDate(iso: string | null): string {
  if (!iso) return "your next billing period";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "your next billing period" : d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function pagesText(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "page" : "pages"}`;
}

/** The drop target under the pointer, from the cards' data attributes. */
function dropTargetAt(x: number, y: number, dragKey: string): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) return null;
  if (el.closest("[data-drop-separate]")) return { kind: "separate" };
  const card = el.closest<HTMLElement>("[data-source-key]");
  if (card) {
    const key = card.dataset.sourceKey!;
    if (key === dragKey) return null;
    const r = card.getBoundingClientRect();
    return { kind: "source", key, place: y < r.top + r.height / 2 ? "before" : "after" };
  }
  const unit = el.closest<HTMLElement>("[data-unit-id]");
  return unit ? { kind: "unit", unitId: unit.dataset.unitId! } : null;
}

function applyDrop(units: UploadUnit[], key: string, target: DropTarget): UploadUnit[] {
  if (target.kind === "separate") return separateSource(units, key);
  if (target.kind === "unit") {
    const u = units.find((x) => x.id === target.unitId);
    return u ? moveSource(units, key, u.id, u.keys.length) : units;
  }
  // Dropped on a lone file: that file stays first, so the new material is named after it.
  const alone = unitOf(units, target.key)?.keys.length === 1;
  return combineWith(units, key, target.key, alone ? "after" : target.place);
}

const inputClass =
  "block w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none ring-violet-500 placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const labelClass = "block text-sm font-medium text-zinc-800 dark:text-zinc-200";
const pill = (active: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm transition ${
    active
      ? "border-violet-600 bg-violet-600 text-white shadow-sm"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
  }`;
const smallButton =
  "rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
const badgeClass = "shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

function Grip({ label, onKeyDown, disabled }: { label: string; onKeyDown?: (e: React.KeyboardEvent) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      data-drag-handle
      aria-label={label}
      disabled={disabled}
      onKeyDown={onKeyDown}
      className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 active:cursor-grabbing disabled:cursor-default disabled:opacity-40 dark:text-zinc-500 dark:hover:text-zinc-300"
    >
      <svg viewBox="0 0 10 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="2.5" cy="2" r="1.5" />
        <circle cx="7.5" cy="2" r="1.5" />
        <circle cx="2.5" cy="8" r="1.5" />
        <circle cx="7.5" cy="8" r="1.5" />
        <circle cx="2.5" cy="14" r="1.5" />
        <circle cx="7.5" cy="14" r="1.5" />
      </svg>
    </button>
  );
}

export function CourseBuildUpload({ userId, enabled, courses, initialCourseId, initialSectionId, prefill, limits }: Props) {
  const router = useRouter();
  const [courseMode, setCourseMode] = useState<"existing" | "new">(initialCourseId ? "existing" : "new");
  const [courseId, setCourseId] = useState(initialCourseId ?? courses[0]?.id ?? "");
  const [newCourseTitle, setNewCourseTitle] = useState(prefill && !initialCourseId ? prefill.label : "");
  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  const sections = courseMode === "existing" ? (course?.sections ?? []) : [];
  const [sectionId, setSectionId] = useState<string>(() => {
    const c = courses.find((x) => x.id === (initialCourseId ?? ""));
    if (initialSectionId && c?.sections.some((s) => s.id === initialSectionId)) return initialSectionId;
    return c?.sections[0]?.id ?? "";
  });
  const [newSectionName, setNewSectionName] = useState("");
  const addingSection = courseMode === "new" || sections.length === 0 || sectionId === "";

  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    prefill
      ? {
          [`app-${prefill.id}`]: {
            source: { key: `app-${prefill.id}`, type: "app", kind: prefill.kind, id: prefill.id, label: prefill.label },
            file: null,
            badge: PREFILL_NOUN[prefill.kind],
            detail: null,
          },
        }
      : {}
  );
  const [units, setUnits] = useState<UploadUnit[]>(() => (prefill ? addSingles([], [`app-${prefill.id}`]) : []));
  const [counts, setCounts] = useState<Record<string, PageCount>>({});
  const [showText, setShowText] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState("");
  const [language, setLanguage] = useState<string>(MATCH_MY_FILES);
  const [goal, setGoal] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<null | "uploading" | "starting">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const countQueue = useRef<Promise<void>>(Promise.resolve());

  const [drag, setDrag] = useState<DragView | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const dragStart = useRef<{ key: string; pointerId: number; x: number; y: number } | null>(null);

  const pagesLeft = remaining(limits.pagesUsed, limits.pagesCap);
  const needsPlan = limits.pagesCap === 0;
  const outOfPages = !needsPlan && pagesLeft === 0;

  const byKey = useMemo(() => new Map(Object.values(entries).map((e) => [e.source.key, e.source])), [entries]);
  const fileCount = Object.values(entries).filter((e) => e.file).length;
  const textCount = Object.values(entries).filter((e) => e.source.type === "text").length;
  const linkCount = Object.values(entries).filter((e) => e.source.type === "url").length;
  const pendingText = showText && pasted.trim().length > 0;
  const pendingLink = showLink && link.trim().length > 0;
  const totals = units.reduce(
    (acc, u) => {
      const p = unitPages(u, counts);
      return { pages: acc.pages + p.pages, uncounted: acc.uncounted || p.uncounted || p.counting };
    },
    { pages: 0, uncounted: false }
  );

  const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextKey.current++}`;

  function addEntries(list: Entry[], pages: Record<string, PageCount>) {
    if (list.length === 0) return;
    setEntries((prev) => ({ ...prev, ...Object.fromEntries(list.map((e) => [e.source.key, e])) }));
    setUnits((prev) => addSingles(prev, list.map((e) => e.source.key)));
    setCounts((prev) => ({ ...prev, ...pages }));
  }

  function addFiles(list: FileList | File[]) {
    setError(null);
    const next: Entry[] = [];
    for (const file of Array.from(list)) {
      const problem = fileProblem(file);
      if (problem) {
        setError(problem);
        continue;
      }
      if (fileCount + next.length >= MAX_FILES) {
        setError(`Add at most ${MAX_FILES} files at a time.`);
        break;
      }
      next.push({ source: { key: newKey("file"), type: "file", name: file.name }, file, badge: kindLabel(file.name) ?? "", detail: null });
    }
    addEntries(next, Object.fromEntries(next.map((e) => [e.source.key, "counting" as const])));
    for (const e of next) {
      countQueue.current = countQueue.current.then(async () => {
        const c = await countFilePages(e.file!);
        setCounts((prev) => (e.source.key in prev ? { ...prev, [e.source.key]: c ? c.pages : null } : prev));
      });
    }
  }

  function textEntry(text: string): Entry {
    const clean = text.trim();
    const n = textCount + 1;
    return {
      source: { key: newKey("text"), type: "text", label: n > 1 ? `Pasted text ${n}` : "Pasted text", text: clean },
      file: null,
      badge: "Text",
      detail: clean.replace(/\s+/g, " ").slice(0, 90),
    };
  }

  function linkEntry(url: string): Entry {
    return { source: { key: newKey("url"), type: "url", url: url.trim() }, file: null, badge: "Link", detail: url.trim() };
  }

  function addPastedText() {
    if (!pasted.trim()) return;
    if (textCount >= MAX_TEXTS) return setError(`Add at most ${MAX_TEXTS} pasted texts.`);
    const e = textEntry(pasted);
    addEntries([e], { [e.source.key]: textPages(pasted) });
    setPasted("");
    setShowText(false);
  }

  function addLink() {
    if (!link.trim()) return;
    if (linkCount >= MAX_LINKS) return setError(`Add at most ${MAX_LINKS} links.`);
    const e = linkEntry(link);
    addEntries([e], { [e.source.key]: null });
    setLink("");
    setShowLink(false);
  }

  function remove(key: string) {
    setUnits((prev) => removeSource(prev, key));
    setEntries((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function onCardPointerDown(e: React.PointerEvent, key: string) {
    if (busy || units.reduce((n, u) => n + u.keys.length, 0) < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const onHandle = !!target.closest("[data-drag-handle]");
    // Touch drags start from the handle only, so the rest of the card still scrolls the page.
    if (!onHandle && (e.pointerType !== "mouse" || target.closest("button, input, select, textarea, a, label"))) return;
    e.preventDefault();
    dragStart.current = { key, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    setDrag({ key, x: e.clientX, y: e.clientY, active: false });
  }

  const dragKey = drag?.key ?? null;
  useEffect(() => {
    if (!dragKey) return;
    let active = false;
    let target: DropTarget | null = null;
    const onMove = (e: PointerEvent) => {
      const start = dragStart.current;
      if (!start || e.pointerId !== start.pointerId) return;
      if (!active && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      active = true;
      e.preventDefault();
      target = dropTargetAt(e.clientX, e.clientY, dragKey);
      setDrag({ key: dragKey, x: e.clientX, y: e.clientY, active: true });
      setDrop(target);
    };
    const finish = (commit: boolean) => {
      const t = target;
      if (commit && active && t) setUnits((prev) => applyDrop(prev, dragKey, t));
      dragStart.current = null;
      setDrag(null);
      setDrop(null);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    const style = document.body.style;
    const prevSelect = style.userSelect;
    const prevWebkit = style.webkitUserSelect;
    style.userSelect = "none";
    style.webkitUserSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      style.userSelect = prevSelect;
      style.webkitUserSelect = prevWebkit;
    };
  }, [dragKey]);

  async function submit() {
    setError(null);
    // Text or a link typed but not added yet becomes its own material.
    const extra: Entry[] = [];
    if (pendingText) extra.push(textEntry(pasted));
    if (pendingLink) extra.push(linkEntry(link));
    const allEntries: Record<string, Entry> = { ...entries, ...Object.fromEntries(extra.map((e) => [e.source.key, e])) };
    const allUnits = addSingles(units, extra.map((e) => e.source.key));
    if (extra.length) {
      addEntries(extra, Object.fromEntries(extra.map((e) => [e.source.key, e.source.type === "text" ? textPages(e.source.text) : null])));
      setPasted("");
      setLink("");
      setShowText(false);
      setShowLink(false);
    }
    if (allUnits.length === 0) return setError("Add at least one file, link, or text to build from.");
    if (courseMode === "new" && newCourseTitle.trim().length < 2) return setError("Give the new course a name.");
    if (courseMode === "existing" && !courseId) return setError("Pick a course.");

    const supabase = createClient();
    const storagePaths = new Map<string, string>();
    const removeUploads = (keys: string[]) => {
      const paths = keys.map((k) => storagePaths.get(k)).filter((p): p is string => !!p);
      if (paths.length) void supabase.storage.from(STUDY_PDF_INGEST_BUCKET).remove(paths).catch(() => {});
    };
    const fileEntries = allUnits.flatMap((u) => u.keys).map((k) => allEntries[k]).filter((e): e is Entry => !!e?.file);
    if (fileEntries.length > 0) {
      setBusy("uploading");
      const results = await Promise.all(
        fileEntries.map(async (e) => {
          const info = ingestStoragePathForFile(userId, e.file!);
          if (!info) return { e, error: "This file type isn't supported." };
          const { error: upErr } = await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .upload(info.storagePath, e.file!, { contentType: info.contentType, cacheControl: "3600", upsert: false });
          if (upErr) return { e, error: describePdfIngestUploadFailure(upErr.message) };
          storagePaths.set(e.source.key, info.storagePath);
          return { e, error: null };
        })
      );
      const failed = results.find((r) => r.error);
      if (failed) {
        removeUploads([...storagePaths.keys()]);
        setBusy(null);
        return setError(`${failed.e.file!.name}: ${failed.error}`);
      }
    }

    setBusy("starting");
    const requests = buildRequests(allUnits, new Map(Object.values(allEntries).map((e) => [e.source.key, e.source])), storagePaths);
    let targetCourse = courseMode === "existing" ? courseId : null;
    let targetSection = addingSection ? null : sectionId;
    const started: string[] = [];

    for (let i = 0; i < requests.length; i++) {
      const req = requests[i]!;
      const res = await fetch("/api/course-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: targetCourse ?? undefined,
          newCourseTitle: targetCourse ? undefined : newCourseTitle.trim(),
          sectionId: targetSection ?? undefined,
          newSectionName: targetSection ? undefined : newSectionName.trim(),
          sources: req.sources,
          title: req.title ?? undefined,
          outputLanguage: language,
          studyGoal: goal.trim(),
        }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { buildId?: string; courseId?: string; sectionId?: string; error?: string };
      if (!res || !res.ok || !data.buildId || !data.courseId) {
        setBusy(null);
        removeUploads(requests.slice(i).flatMap((r) => r.keys));
        const message = data?.error || "We couldn't start the build. Check your connection and try again.";
        if (started.length === 0) return setError(message);
        // The started ones keep going; leave only the rest on screen so trying again doesn't repeat them.
        const done = new Set(requests.slice(0, i).flatMap((r) => r.keys));
        setUnits(allUnits.filter((u) => !u.keys.some((k) => done.has(k))));
        if (targetCourse) {
          setCourseMode("existing");
          setCourseId(targetCourse);
        }
        return setError(`${message} ${started.length} of ${requests.length} materials started and will appear in your course.`);
      }
      targetCourse = data.courseId;
      targetSection = data.sectionId ?? targetSection;
      watchBuild(data.buildId, data.courseId);
      started.push(data.buildId);
    }

    const [firstBuild, ...rest] = started;
    router.push(`/dashboard/courses/${targetCourse}/build/${firstBuild}${rest.length ? `?also=${rest.join(",")}` : ""}`);
  }

  const disabled = !enabled || busy !== null || outOfPages || needsPlan;
  const locked = busy !== null;
  const canDrag = !locked && units.reduce((n, u) => n + u.keys.length, 0) >= 2;
  const draggingGrouped = drag?.active ? isGroup(unitOf(units, drag.key) ?? { id: "", keys: [], name: null }) : false;
  const dragSource = drag ? byKey.get(drag.key) : undefined;
  const dropHint = (() => {
    if (!drag?.active || !drop) return null;
    if (drop.kind === "separate") return "Make it its own material";
    const target = drop.kind === "unit" ? units.find((u) => u.id === drop.unitId) : unitOf(units, drop.key);
    if (!target) return null;
    if (target.keys.includes(drag.key)) return "Move here";
    return `Combine with ${isGroup(target) ? unitTitle(target, byKey) : sourceName(byKey.get(target.keys[0]!)!)}`;
  })();

  const pageLine = (u: UploadUnit) => {
    const p = unitPages(u, counts);
    if (p.counting && p.pages === 0) return <span className="text-xs text-zinc-400">Counting pages…</span>;
    if (p.pages === 0 && p.uncounted) return <span className="text-xs text-zinc-400">Pages counted when it builds</span>;
    const over = pagesLeft != null && p.pages > pagesLeft;
    return (
      <span className={`text-xs ${over ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
        {pagesText(p.pages)}
        {p.uncounted || p.counting ? "+" : ""}
        {pagesLeft != null ? ` of ${pagesLeft.toLocaleString()} left` : ""}
        {over ? " · more than your plan has left" : ""}
      </span>
    );
  };

  const sourceRow = (key: string, u: UploadUnit, index: number) => {
    const entry = entries[key];
    if (!entry) return null;
    const grouped = isGroup(u);
    const count = counts[key];
    const isDragged = drag?.active && drag.key === key;
    const isTarget = drag?.active && drop?.kind === "source" && drop.key === key;
    const edge =
      isTarget && grouped && drop?.kind === "source"
        ? drop.place === "before"
          ? "shadow-[0_-3px_0_0_rgb(139,92,246)]"
          : "shadow-[0_3px_0_0_rgb(139,92,246)]"
        : "";
    const others = units.filter((x) => x.id !== u.id);
    return (
      <div
        key={key}
        data-source-key={key}
        onPointerDown={(e) => onCardPointerDown(e, key)}
        className={`flex select-none items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 text-sm transition-[opacity,box-shadow,border-color] dark:bg-zinc-900 ${
          isTarget && !grouped
            ? "border-violet-500 ring-2 ring-violet-500/40"
            : "border-zinc-200 dark:border-zinc-800"
        } ${edge} ${isDragged ? "opacity-40" : ""} ${canDrag ? "cursor-grab" : ""}`}
      >
        <Grip
          disabled={!canDrag}
          label={grouped ? `Drag ${sourceName(entry.source)} to reorder or move it` : `Drag ${sourceName(entry.source)} onto another file to combine`}
          onKeyDown={(e) => {
            if (!grouped) return;
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setUnits((prev) => nudgeSource(prev, key, -1));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setUnits((prev) => nudgeSource(prev, key, 1));
            }
          }}
        />
        {grouped ? <span className="w-4 shrink-0 text-right text-xs tabular-nums text-violet-500">{index + 1}</span> : null}
        <span className={badgeClass}>{entry.badge}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-zinc-800 dark:text-zinc-100">
            {entry.source.type === "file" ? entry.source.name : sourceName(entry.source)}
          </span>
          {entry.detail ? <span className="block truncate text-xs text-zinc-400">{entry.detail}</span> : null}
        </span>
        <span className="hidden shrink-0 text-xs tabular-nums text-zinc-400 sm:inline">
          {count === "counting" ? "…" : typeof count === "number" ? `${entry.badge === "Audio" || entry.badge === "Video" ? "~" : ""}${pagesText(count)}` : ""}
        </span>
        {grouped ? (
          <span className="flex shrink-0 items-center">
            <button type="button" disabled={locked || index === 0} className={smallButton} aria-label="Move up" onClick={() => setUnits((prev) => nudgeSource(prev, key, -1))}>
              ↑
            </button>
            <button
              type="button"
              disabled={locked || index === u.keys.length - 1}
              className={smallButton}
              aria-label="Move down"
              onClick={() => setUnits((prev) => nudgeSource(prev, key, 1))}
            >
              ↓
            </button>
            <button type="button" disabled={locked} className={smallButton} onClick={() => setUnits((prev) => separateSource(prev, key))}>
              Separate
            </button>
          </span>
        ) : others.length > 0 ? (
          <select
            aria-label={`Combine ${sourceName(entry.source)} with another material`}
            disabled={locked}
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) setUnits((prev) => moveSource(prev, key, id, prev.find((x) => x.id === id)?.keys.length ?? 0));
            }}
            className="max-w-[9.5rem] shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">Combine with…</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {isGroup(x) ? unitTitle(x, byKey) : sourceName(byKey.get(x.keys[0]!)!)}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" disabled={locked} className={smallButton} onClick={() => remove(key)}>
          Remove
        </button>
      </div>
    );
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Course builder</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {courseMode === "existing" && course ? `Add materials to ${course.title}` : "Build a course"}
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Drop in your lecture slides, readings, recordings or notes. Each upload becomes a material with modules, lessons and a quiz,
        written only from what&apos;s in your files.
      </p>

      {!enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Course building is turned off right now. Your existing courses still work.
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-3">
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Pages of course material left</p>
          <p className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {pagesLeft == null ? "Unlimited" : `${pagesLeft.toLocaleString()} of ${limits.pagesCap?.toLocaleString()}`}
          </p>
          {pagesLeft != null && !needsPlan ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
              Every page you upload counts, for new and existing courses. Resets {resetDate(limits.periodEnd)}
            </p>
          ) : null}
        </div>
      </div>

      <section className="mt-8 space-y-3">
        <span className={labelClass}>Course</span>
        <div className="flex flex-wrap gap-2">
          {courses.length > 0 ? (
            <button
              type="button"
              className={pill(courseMode === "existing")}
              onClick={() => {
                setCourseMode("existing");
                setSectionId(course?.sections[0]?.id ?? "");
              }}
            >
              Existing course
            </button>
          ) : null}
          <button type="button" className={pill(courseMode === "new")} onClick={() => setCourseMode("new")}>
            New course
          </button>
        </div>
        {courseMode === "existing" ? (
          <select
            className={inputClass}
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setSectionId(courses.find((c) => c.id === e.target.value)?.sections[0]?.id ?? "");
            }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={inputClass}
            placeholder="Course name, e.g. Bio 1A"
            maxLength={120}
            value={newCourseTitle}
            onChange={(e) => setNewCourseTitle(e.target.value)}
          />
        )}
      </section>

      <section className="mt-6 space-y-3">
        <span className={labelClass}>Section</span>
        {sections.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <button key={s.id} type="button" className={pill(sectionId === s.id)} onClick={() => setSectionId(s.id)}>
                {s.name}
              </button>
            ))}
            <button type="button" className={pill(sectionId === "")} onClick={() => setSectionId("")}>
              + New section
            </button>
          </div>
        ) : null}
        {addingSection ? (
          <input
            className={inputClass}
            placeholder="Section name, e.g. Midterm 1 (optional)"
            maxLength={120}
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <span className={labelClass}>What to build from</span>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging
              ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
              : "border-zinc-300 bg-zinc-50/60 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900/40"
          }`}
        >
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Drop files here or click to choose</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">PDF, PowerPoint, Word, text, audio or video · up to 20 files</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {units.length > 1 ? (
          <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Each file becomes its own material. To make one material from several, like a lecture&apos;s slides plus its recording, drag one onto
            another or use Combine with…
          </p>
        ) : null}

        {units.length > 0 ? (
          <div className="mt-3 space-y-2">
            {units.map((u) => {
              if (!isGroup(u)) {
                return (
                  <div key={u.id} data-unit-id={u.id}>
                    {sourceRow(u.keys[0]!, u, 0)}
                    {pagesLeft != null && unitPages(u, counts).pages > pagesLeft ? (
                      <p className="mt-1 px-1 text-xs text-red-600 dark:text-red-400">
                        This has more pages than the {pagesText(pagesLeft)} your plan has left.
                      </p>
                    ) : null}
                  </div>
                );
              }
              const isTarget = drag?.active && drop?.kind === "unit" && drop.unitId === u.id;
              return (
                <div
                  key={u.id}
                  data-unit-id={u.id}
                  className={`rounded-2xl border p-3 transition ${
                    isTarget
                      ? "border-violet-500 bg-violet-50 ring-2 ring-violet-500/40 dark:bg-violet-950/40"
                      : "border-violet-200 bg-violet-50/50 dark:border-violet-900/60 dark:bg-violet-950/20"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Combined</span>
                    <input
                      aria-label="Material name"
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-zinc-900 outline-none hover:border-violet-200 focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-500/30 dark:text-zinc-50 dark:hover:border-violet-900 dark:focus:bg-zinc-900"
                      maxLength={140}
                      disabled={locked}
                      placeholder={defaultUnitName(u, byKey)}
                      value={u.name ?? defaultUnitName(u, byKey)}
                      onChange={(e) => setUnits((prev) => renameUnit(prev, u.id, e.target.value))}
                    />
                    <button type="button" disabled={locked} className={smallButton} onClick={() => setUnits((prev) => ungroup(prev, u.id))}>
                      Uncombine
                    </button>
                  </div>
                  <p className="mt-1 px-2 text-xs text-zinc-500 dark:text-zinc-400">
                    One material from {u.keys.length} sources, read in this order. The name above becomes its title.
                  </p>
                  <div className="mt-2 space-y-1.5">{u.keys.map((k, i) => sourceRow(k, u, i))}</div>
                  <p className="mt-2 px-2">{pageLine(u)}</p>
                </div>
              );
            })}
            {draggingGrouped ? (
              <div
                data-drop-separate
                className={`rounded-xl border-2 border-dashed px-4 py-3 text-center text-xs transition ${
                  drop?.kind === "separate"
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                    : "border-zinc-300 text-zinc-500 dark:border-zinc-700"
                }`}
              >
                Drop here to make it its own material
              </div>
            ) : null}
            {units.length > 1 ? (
              <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
                {units.length} materials · {pagesText(totals.pages)}
                {totals.uncounted ? "+" : ""} in total
                {pagesLeft != null ? ` · ${pagesLeft.toLocaleString()} left on your plan` : ""}
                {pagesLeft != null && totals.pages > pagesLeft ? (
                  <span className="block text-red-600 dark:text-red-400">
                    That&apos;s more than you have left, so the last materials may not build. Remove some files or upgrade.
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={pill(showText)} onClick={() => setShowText((v) => !v)}>
            Paste text
          </button>
          <button type="button" className={pill(showLink)} onClick={() => setShowLink((v) => !v)}>
            Add a link
          </button>
        </div>
        {showText ? (
          <div className="mt-3 space-y-2">
            <textarea
              className={`${inputClass} min-h-40`}
              placeholder="Paste a transcript, article or notes"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button type="button" disabled={!pasted.trim() || locked} className={`${pill(false)} disabled:opacity-40`} onClick={addPastedText}>
              Add text
            </button>
          </div>
        ) : null}
        {showLink ? (
          <div className="mt-3 flex gap-2">
            <input
              className={inputClass}
              type="url"
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <button type="button" disabled={!link.trim() || locked} className={`${pill(false)} shrink-0 disabled:opacity-40`} onClick={addLink}>
              Add link
            </button>
          </div>
        ) : null}
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <label className="space-y-2">
          <span className={labelClass}>Language</span>
          <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {BUILD_LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className={labelClass}>
            What&apos;s this for? <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <input
            className={inputClass}
            placeholder="e.g. Bio 1A midterm, focus on metabolism"
            maxLength={300}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Shapes emphasis only. Nothing is added that isn&apos;t in your files.</span>
        </label>
      </section>

      {needsPlan ? (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400">
          <Link href="/dashboard/billing" className="underline">
            Choose a plan
          </Link>{" "}
          to build an AI course from your materials.
        </p>
      ) : outOfPages ? (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400">
          You&apos;ve used all your pages of course material for this period. They reset {resetDate(limits.periodEnd)}, or you can{" "}
          <Link href="/dashboard/billing" className="underline">
            upgrade
          </Link>{" "}
          for more pages.
        </p>
      ) : null}
      {error ? <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void submit()}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-50"
        >
          {busy === "uploading"
            ? "Uploading…"
            : busy === "starting"
              ? "Starting…"
              : units.length + (pendingText ? 1 : 0) + (pendingLink ? 1 : 0) > 1
                ? `Build ${units.length + (pendingText ? 1 : 0) + (pendingLink ? 1 : 0)} materials`
                : "Build"}
        </button>
        <Link href={courseMode === "existing" && courseId ? `/dashboard/courses/${courseId}` : "/dashboard"} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          Cancel
        </Link>
      </div>

      {drag?.active && dragSource ? (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm shadow-xl shadow-violet-600/10 dark:border-violet-800 dark:bg-zinc-900"
          style={{ left: drag.x + 14, top: drag.y + 12 }}
        >
          <span className="block truncate font-medium text-zinc-800 dark:text-zinc-100">{sourceName(dragSource)}</span>
          {dropHint ? <span className="block text-xs text-violet-600 dark:text-violet-400">{dropHint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
