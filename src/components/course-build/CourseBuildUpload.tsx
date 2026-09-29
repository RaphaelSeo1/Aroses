"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { BUILD_LANGUAGE_OPTIONS, MATCH_MY_FILES } from "@/lib/course-build/language";
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

type PickedFile = { key: string; file: File; label: string };

const ACCEPT = ".pdf,.pptx,.docx,.txt,.md,.markdown,.rtf,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm";
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

const inputClass =
  "block w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none ring-violet-500 placeholder:text-zinc-400 focus:border-violet-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const labelClass = "block text-sm font-medium text-zinc-800 dark:text-zinc-200";
const pill = (active: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm transition ${
    active
      ? "border-violet-600 bg-violet-600 text-white shadow-sm"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
  }`;

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

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [appSource, setAppSource] = useState<BuilderPrefill | null>(prefill);
  const [showText, setShowText] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState("");
  const [separate, setSeparate] = useState(false);
  const [language, setLanguage] = useState<string>(MATCH_MY_FILES);
  const [goal, setGoal] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<null | "uploading" | "starting">(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pagesLeft = remaining(limits.pagesUsed, limits.pagesCap);
  const needsPlan = limits.pagesCap === 0;
  const outOfPages = !needsPlan && pagesLeft === 0;

  const hasText = showText && pasted.trim().length > 0;
  const hasLink = showLink && link.trim().length > 0;
  const sourceCount = files.length + (hasText ? 1 : 0) + (hasLink ? 1 : 0) + (appSource ? 1 : 0);

  function addFiles(list: FileList | File[]) {
    setError(null);
    const next: PickedFile[] = [];
    for (const file of Array.from(list)) {
      const problem = fileProblem(file);
      if (problem) {
        setError(problem);
        continue;
      }
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, label: kindLabel(file.name) ?? "" });
    }
    setFiles((prev) => [...prev, ...next].slice(0, 20));
  }

  async function submit() {
    setError(null);
    if (sourceCount === 0) return setError("Add at least one file, link, or text to build from.");
    if (courseMode === "new" && newCourseTitle.trim().length < 2) return setError("Give the new course a name.");
    if (courseMode === "existing" && !courseId) return setError("Pick a course.");

    const supabase = createClient();
    const uploaded: Array<{ key: string; storagePath: string; name: string }> = [];
    if (files.length > 0) {
      setBusy("uploading");
      const results = await Promise.all(
        files.map(async (f) => {
          const info = ingestStoragePathForFile(userId, f.file);
          if (!info) return { f, error: "This file type isn't supported." };
          const { error: upErr } = await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .upload(info.storagePath, f.file, { contentType: info.contentType, cacheControl: "3600", upsert: false });
          if (upErr) return { f, error: describePdfIngestUploadFailure(upErr.message) };
          uploaded.push({ key: f.key, storagePath: info.storagePath, name: f.file.name });
          return { f, error: null };
        })
      );
      const failed = results.find((r) => r.error);
      if (failed) {
        await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .remove(uploaded.map((u) => u.storagePath))
          .catch(() => {});
        setBusy(null);
        return setError(`${failed.f.file.name}: ${failed.error}`);
      }
    }

    setBusy("starting");
    const ordered = files.map((f) => uploaded.find((u) => u.key === f.key)!).map((u) => ({ storagePath: u.storagePath, name: u.name }));
    const groups = separate && ordered.length > 1 ? ordered.map((f) => [f]) : [ordered];
    let targetCourse = courseMode === "existing" ? courseId : null;
    let targetSection = addingSection ? null : sectionId;
    const started: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const first = i === 0;
      const res = await fetch("/api/course-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: targetCourse ?? undefined,
          newCourseTitle: targetCourse ? undefined : newCourseTitle.trim(),
          sectionId: targetSection ?? undefined,
          newSectionName: targetSection ? undefined : newSectionName.trim(),
          files: groups[i],
          texts: first && hasText ? [{ label: "Pasted text", text: pasted }] : [],
          urls: first && hasLink ? [link.trim()] : [],
          app: first && appSource ? [{ kind: appSource.kind, id: appSource.id }] : [],
          outputLanguage: language,
          studyGoal: goal.trim(),
        }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { buildId?: string; courseId?: string; sectionId?: string; error?: string };
      if (!res || !res.ok || !data.buildId || !data.courseId) {
        setBusy(null);
        if (started.length === 0) {
          await supabase.storage
            .from(STUDY_PDF_INGEST_BUCKET)
            .remove(uploaded.map((u) => u.storagePath))
            .catch(() => {});
        }
        return setError(data?.error || "We couldn't start the build. Check your connection and try again.");
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

        {files.length > 0 || appSource ? (
          <ul className="mt-3 space-y-2">
            {appSource ? (
              <li className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-2.5 text-sm dark:border-violet-900/60 dark:bg-violet-950/30">
                <span className="rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                  {PREFILL_NOUN[appSource.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">{appSource.label}</span>
                <button type="button" className="text-xs text-zinc-500 hover:text-zinc-800" onClick={() => setAppSource(null)}>
                  Remove
                </button>
              </li>
            ) : null}
            {files.map((f) => (
              <li
                key={f.key}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {f.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">{f.file.name}</span>
                <span className="text-xs text-zinc-400">{(f.file.size / 1048576).toFixed(1)} MB</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40"
                  onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
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
          <textarea
            className={`${inputClass} mt-3 min-h-40`}
            placeholder="Paste a transcript, article or notes"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        ) : null}
        {showLink ? (
          <input
            className={`${inputClass} mt-3`}
            type="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        ) : null}

        {files.length > 1 ? (
          <label className="mt-4 flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" className="mt-0.5" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
            <span>
              Make a separate material for each file
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Leave this off to combine them into one material, e.g. a lecture&apos;s slides plus its recording.
              </span>
            </span>
          </label>
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
          {busy === "uploading" ? "Uploading…" : busy === "starting" ? "Starting…" : "Build"}
        </button>
        <Link href={courseMode === "existing" && courseId ? `/dashboard/courses/${courseId}` : "/dashboard"} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          Cancel
        </Link>
      </div>
    </div>
  );
}
