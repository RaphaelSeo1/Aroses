import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { NotesHubClient } from "@/components/notes-hub/NotesHubClient";
import type { NoteDocCardData, NoteHubSection } from "@/lib/notes/hub-types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

  const [standaloneRes, liveRes, tutorRes, courseNotesRes, lessonNotesRes] =
    await Promise.all([
      supabase
        .from("user_notes")
        .select(
          "id, title, content_text, updated_at, course_id, ingest_job_id"
        )
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(60),
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

  const standaloneNotes = standaloneRes.data ?? [];
  const liveSessions = liveRes.data ?? [];
  const tutorSessions = (tutorRes.data ?? []).filter(
    (s) => typeof s.live_notes_text === "string" && s.live_notes_text.trim()
  );
  const courseNotes = (courseNotesRes.data ?? []).filter(
    (n) => typeof n.content_text === "string" && n.content_text.trim()
  );
  const lessonNotes = lessonNotesRes.data ?? [];

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

  const standaloneCards: NoteDocCardData[] = standaloneNotes.map((n) => ({
    key: `standalone-${n.id}`,
    href: `/notes/doc/${n.id}`,
    title: (n.title as string) || "Untitled note",
    subtitle: n.ingest_job_id ? "Course build started" : "My notes",
    preview: preview(n.content_text),
    dateLabel: formatDate(n.updated_at as string),
    ref: { kind: "standalone", id: n.id as string },
    deletable: true,
    chip: n.ingest_job_id
      ? { label: "Course", tone: "done" as const }
      : undefined,
  }));

  const liveCards: NoteDocCardData[] = liveSessions.map((s) => {
    const status = s.status as string;
    const isActive = status === "recording" || status === "paused";
    const chip =
      status === "recording"
        ? { label: "Live", tone: "live" as const }
        : status === "paused"
          ? { label: "Paused", tone: "paused" as const }
          : status === "failed"
            ? { label: "Failed", tone: "failed" as const }
            : { label: "Completed", tone: "done" as const };
    return {
      key: `live-${s.id}`,
      href: `/dashboard/courses/${s.course_id}/live-notes/${s.id}`,
      title: (s.title as string) || "Live lecture",
      subtitle: courseTitleById.get(s.course_id as string) ?? null,
      preview: preview(s.notes_text),
      dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
      isLive: isActive,
      chip,
      ref: { kind: "live", id: s.id as string },
      deletable: !isActive,
    };
  });

  const tutorCards: NoteDocCardData[] = tutorSessions.map((s) => ({
    key: `tutor-${s.id}`,
    href: `/notes/tutor/${s.id}`,
    title: (s.title as string) || (s.topic as string) || "Tutor session",
    subtitle:
      typeof s.topic === "string" && s.topic.trim() ? s.topic.trim() : null,
    preview: preview(s.live_notes_text),
    dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
    ref: { kind: "tutor", id: s.id as string },
    deletable: true,
  }));

  const courseNoteCards: NoteDocCardData[] = courseNotes.map((n) => {
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
      ref: { kind: "course", materialId: n.material_id as string },
      deletable: true,
    };
  });

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
  const lessonCards: NoteDocCardData[] = Array.from(lessonGroups.entries()).map(
    ([materialId, g]) => {
      const material = materialById.get(materialId);
      return {
        key: `lesson-${materialId}`,
        href: `/notes/lesson/${materialId}`,
        title: materialTitle(material?.file_name),
        subtitle: material
          ? (courseTitleById.get(material.course_id) ?? null)
          : null,
        preview: g.snippets.join(" · ") || null,
        dateLabel: `${g.count} note${g.count === 1 ? "" : "s"}${
          formatDate(g.latest) ? ` · ${formatDate(g.latest)}` : ""
        }`,
        ref: { kind: "lesson", materialId },
        deletable: true,
      };
    }
  );

  const sections: NoteHubSection[] = [
    {
      id: "standalone",
      title: "My notes",
      hint: "Notes you created here — keep as notes or build a course anytime.",
      cards: standaloneCards,
    },
    {
      id: "live",
      title: "Live lectures",
      hint: "Recorded lectures keep their notes and full transcript — even after the course is built.",
      cards: liveCards,
    },
    {
      id: "tutor",
      title: "Tutor sessions",
      hint: "Notes taken while studying one-on-one with Rose.",
      cards: tutorCards,
    },
    {
      id: "course",
      title: "Course notes",
      hint: "Your running notes from mentored learning, one document per material.",
      cards: courseNoteCards,
    },
    {
      id: "lesson",
      title: "Lesson notes",
      hint: "Highlights and short notes from self-study — grouped by material, one card per upload.",
      cards: lessonCards,
    },
  ].filter((s) => s.cards.length > 0);

  const empty = sections.length === 0;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
            Your library
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
            Notes
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Write notes, or browse everything from live lectures, tutor
            sessions, and courses — build a course when you are ready.
          </p>

          <NotesHubClient sections={sections} empty={empty} />
        </div>
      </main>
    </>
  );
}
