import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { createClient } from "@/lib/supabase/server";

/**
 * Notes hub — every place the user has taken notes, in one library:
 *
 *   - Live lectures  (live_lecture_sessions — including completed ones,
 *     which keep their notes + full transcript on the session page)
 *   - Tutor sessions (tutor_sessions.live_notes_*)
 *   - Course notes   (user_course_notes — mentored learning, per material)
 *   - Lesson notes   (user_lesson_notes — self-study highlights/notes)
 *
 * Cards link to the richest existing view for each source; tutor and
 * course notes open in the hub's own document view (/notes/tutor/[id],
 * /notes/material/[id]) since their original surfaces are transient.
 */

export const dynamic = "force-dynamic";

type CardItem = {
  key: string;
  href: string;
  title: string;
  subtitle: string | null;
  preview: string | null;
  dateLabel: string;
  chip?: { label: string; tone: "live" | "paused" | "done" | "failed" };
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function preview(text: unknown, max = 180): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** "Lecture 3 - Enzymes.pdf" → "Lecture 3 - Enzymes" */
function materialTitle(fileName: string | null | undefined): string {
  if (!fileName) return "Course material";
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || fileName;
}

export default async function NotesHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/notes");
  }

  const [liveRes, tutorRes, courseNotesRes, lessonNotesRes] = await Promise.all([
    supabase
      .from("live_lecture_sessions")
      .select("id, course_id, title, status, started_at, updated_at, notes_text")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(60),
    supabase
      .from("tutor_sessions")
      .select("id, title, topic, status, started_at, updated_at, live_notes_text")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("user_course_notes")
      .select("material_id, content_text, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("user_lesson_notes")
      .select("material_id, note_body, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  const liveSessions = liveRes.data ?? [];
  const tutorSessions = (tutorRes.data ?? []).filter(
    (s) => typeof s.live_notes_text === "string" && s.live_notes_text.trim()
  );
  const courseNotes = (courseNotesRes.data ?? []).filter(
    (n) => typeof n.content_text === "string" && n.content_text.trim()
  );
  const lessonNotes = lessonNotesRes.data ?? [];

  // Resolve material + course names in two batched lookups.
  const materialIds = Array.from(
    new Set(
      [...courseNotes, ...lessonNotes]
        .map((n) => n.material_id as string | null)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: materials } = materialIds.length
    ? await supabase
        .from("study_materials")
        .select("id, file_name, course_id")
        .in("id", materialIds)
    : { data: [] as Array<{ id: string; file_name: string; course_id: string }> };
  const materialById = new Map(
    (materials ?? []).map((m) => [m.id as string, m])
  );

  const courseIds = Array.from(
    new Set([
      ...liveSessions.map((s) => s.course_id as string),
      ...(materials ?? []).map((m) => m.course_id as string),
    ])
  ).filter(Boolean);
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as Array<{ id: string; title: string }> };
  const courseTitleById = new Map(
    (courses ?? []).map((c) => [c.id as string, c.title as string])
  );

  const liveCards: CardItem[] = liveSessions.map((s) => {
    const status = s.status as string;
    const chip: CardItem["chip"] =
      status === "recording"
        ? { label: "Live", tone: "live" }
        : status === "paused"
          ? { label: "Paused", tone: "paused" }
          : status === "failed"
            ? { label: "Failed", tone: "failed" }
            : { label: "Completed", tone: "done" };
    return {
      key: `live-${s.id}`,
      href: `/dashboard/courses/${s.course_id}/live-notes/${s.id}`,
      title: (s.title as string) || "Live lecture",
      subtitle: courseTitleById.get(s.course_id as string) ?? null,
      preview: preview(s.notes_text),
      dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
      chip,
    };
  });

  const tutorCards: CardItem[] = tutorSessions.map((s) => ({
    key: `tutor-${s.id}`,
    href: `/notes/tutor/${s.id}`,
    title: (s.title as string) || (s.topic as string) || "Tutor session",
    subtitle:
      typeof s.topic === "string" && s.topic.trim() ? s.topic.trim() : null,
    preview: preview(s.live_notes_text),
    dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
  }));

  const courseNoteCards: CardItem[] = courseNotes.map((n) => {
    const material = materialById.get(n.material_id as string);
    return {
      key: `course-${n.material_id}`,
      href: `/notes/material/${n.material_id}`,
      title: materialTitle(material?.file_name),
      subtitle: material
        ? (courseTitleById.get(material.course_id) ?? null)
        : null,
      preview: preview(n.content_text),
      dateLabel: formatDate(n.updated_at as string),
    };
  });

  // Lesson notes are many tiny rows — group per material.
  const lessonGroups = new Map<
    string,
    { count: number; latest: string; snippets: string[] }
  >();
  for (const n of lessonNotes) {
    const id = n.material_id as string;
    const g = lessonGroups.get(id) ?? {
      count: 0,
      latest: (n.updated_at as string) ?? "",
      snippets: [],
    };
    g.count += 1;
    if (g.snippets.length < 2) {
      const p = preview(n.note_body, 90);
      if (p) g.snippets.push(p);
    }
    lessonGroups.set(id, g);
  }
  const lessonCards: CardItem[] = Array.from(lessonGroups.entries()).map(
    ([materialId, g]) => {
      const material = materialById.get(materialId);
      return {
        key: `lesson-${materialId}`,
        href: material
          ? `/dashboard/courses/${material.course_id}/study`
          : "/notes",
        title: materialTitle(material?.file_name),
        subtitle: material
          ? (courseTitleById.get(material.course_id) ?? null)
          : null,
        preview: g.snippets.join(" · ") || null,
        dateLabel: `${g.count} note${g.count === 1 ? "" : "s"}${
          formatDate(g.latest) ? ` · ${formatDate(g.latest)}` : ""
        }`,
      };
    }
  );

  const empty =
    liveCards.length === 0 &&
    tutorCards.length === 0 &&
    courseNoteCards.length === 0 &&
    lessonCards.length === 0;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
            Your library
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
            Notes
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Everything you and Rose wrote down — live lectures, tutor
            sessions, and course notes — all in one place.
          </p>

          {empty ? (
            <div className="mt-12 rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                No notes yet
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Notes you take during live lectures, tutor sessions, and
                mentored learning will all show up here automatically.
              </p>
            </div>
          ) : (
            <div className="mt-10 space-y-12">
              <NotesSection
                title="Live lectures"
                hint="Recorded lectures keep their notes and full transcript — even after the course is built."
                cards={liveCards}
              />
              <NotesSection
                title="Tutor sessions"
                hint="Notes taken while studying one-on-one with Rose."
                cards={tutorCards}
              />
              <NotesSection
                title="Course notes"
                hint="Your running notes from mentored learning, one document per material."
                cards={courseNoteCards}
              />
              <NotesSection
                title="Lesson notes"
                hint="Quick notes and highlights captured while self-studying."
                cards={lessonCards}
              />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

const CHIP_TONES: Record<string, string> = {
  live: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function NotesSection({
  title,
  hint,
  cards,
}: {
  title: string;
  hint: string;
  cards: CardItem[];
}) {
  if (cards.length === 0) return null;
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="group flex flex-col rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/90 dark:hover:border-violet-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {c.title}
                </h3>
                {c.subtitle ? (
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-500">
                    {c.subtitle}
                  </p>
                ) : null}
              </div>
              {c.chip ? (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP_TONES[c.chip.tone]}`}
                >
                  {c.chip.label}
                </span>
              ) : null}
            </div>
            {c.preview ? (
              <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {c.preview}
              </p>
            ) : (
              <p className="mt-2.5 text-xs italic text-zinc-400 dark:text-zinc-600">
                No written notes yet
              </p>
            )}
            <p className="mt-auto pt-3 text-[11px] text-zinc-400 dark:text-zinc-600">
              {c.dateLabel}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
