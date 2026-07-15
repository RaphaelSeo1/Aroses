import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { NotesHubClient } from "@/components/notes-hub/NotesHubClient";
import type { NoteDocCardData, NoteHubSection } from "@/lib/notes/hub-types";
import { customSectionId, isCustomSection, parseNoteFolders } from "@/lib/notes/hub-types";
import { applySectionOrder } from "@/lib/notes/hub-layout";
import { buildNoteSearchText } from "@/lib/notes/note-search";
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

  const [standaloneRes, sectionsRes, liveRes, tutorRes, courseNotesRes] =
    await Promise.all([
      supabase
        .from("user_notes")
        .select(
          "id, title, content_text, updated_at, course_id, ingest_job_id, section_id, deleted_at"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(60),
      supabase
        .from("user_note_sections")
        .select("id, title, sort_order, emoji")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("live_lecture_sessions")
        .select(
          "id, course_id, user_note_id, title, status, started_at, updated_at, notes_text, deleted_at"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(60),
      supabase
        .from("tutor_sessions")
        .select(
          "id, title, topic, status, started_at, updated_at, live_notes_text, deleted_at"
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("user_course_notes")
        .select("material_id, content_text, updated_at, deleted_at")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);

  const standaloneNotesRaw = standaloneRes.data ?? [];
  // Migration 091 may not be applied yet — if the select failed on deleted_at,
  // retry without it.
  let standaloneNotes = standaloneNotesRaw;
  let trashedStandalone: typeof standaloneNotesRaw = [];

  if (standaloneRes.error && /deleted_at/i.test(standaloneRes.error.message ?? "")) {
    const fallback = await supabase
      .from("user_notes")
      .select(
        "id, title, content_text, updated_at, course_id, ingest_job_id, section_id"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(60);
    standaloneNotes = (fallback.data ?? []) as typeof standaloneNotesRaw;
  } else {
    const trashedRes = await supabase
      .from("user_notes")
      .select(
        "id, title, content_text, updated_at, course_id, ingest_job_id, section_id, deleted_at"
      )
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(40);
    if (!trashedRes.error) {
      trashedStandalone = trashedRes.data ?? [];
    }
  }

  type LiveRow = NonNullable<typeof liveRes.data>[number];
  type TutorRow = NonNullable<typeof tutorRes.data>[number];
  type CourseNoteRow = NonNullable<typeof courseNotesRes.data>[number];

  let liveSessions: LiveRow[] = liveRes.data ?? [];
  let trashedLive: LiveRow[] = [];
  if (liveRes.error && /deleted_at/i.test(liveRes.error.message ?? "")) {
    const fallback = await supabase
      .from("live_lecture_sessions")
      .select(
        "id, course_id, user_note_id, title, status, started_at, updated_at, notes_text"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(60);
    liveSessions = (fallback.data ?? []) as LiveRow[];
  } else if (!liveRes.error) {
    const trashedRes = await supabase
      .from("live_lecture_sessions")
      .select(
        "id, course_id, user_note_id, title, status, started_at, updated_at, notes_text, deleted_at"
      )
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(40);
    if (!trashedRes.error) trashedLive = (trashedRes.data ?? []) as LiveRow[];
  }

  let tutorSessionsRaw: TutorRow[] = tutorRes.data ?? [];
  let trashedTutor: TutorRow[] = [];
  if (tutorRes.error && /deleted_at/i.test(tutorRes.error.message ?? "")) {
    const fallback = await supabase
      .from("tutor_sessions")
      .select(
        "id, title, topic, status, started_at, updated_at, live_notes_text"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    tutorSessionsRaw = (fallback.data ?? []) as TutorRow[];
  } else if (!tutorRes.error) {
    const trashedRes = await supabase
      .from("tutor_sessions")
      .select(
        "id, title, topic, status, started_at, updated_at, live_notes_text, deleted_at"
      )
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(40);
    if (!trashedRes.error) trashedTutor = (trashedRes.data ?? []) as TutorRow[];
  }

  let courseNotesRaw: CourseNoteRow[] = courseNotesRes.data ?? [];
  let trashedCourse: CourseNoteRow[] = [];
  if (
    courseNotesRes.error &&
    /deleted_at/i.test(courseNotesRes.error.message ?? "")
  ) {
    const fallback = await supabase
      .from("user_course_notes")
      .select("material_id, content_text, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    courseNotesRaw = (fallback.data ?? []) as CourseNoteRow[];
  } else if (!courseNotesRes.error) {
    const trashedRes = await supabase
      .from("user_course_notes")
      .select("material_id, content_text, updated_at, deleted_at")
      .eq("user_id", user.id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(40);
    if (!trashedRes.error) {
      trashedCourse = (trashedRes.data ?? []) as CourseNoteRow[];
    }
  }

  type SectionRow = {
    id: string;
    title: string;
    sort_order: number;
    emoji?: string | null;
  };
  let userSections: SectionRow[] = [];
  if (sectionsRes.error) {
    if (/emoji/i.test(sectionsRes.error.message ?? "")) {
      const fallback = await supabase
        .from("user_note_sections")
        .select("id, title, sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      userSections = (fallback.data ?? []) as SectionRow[];
    }
  } else {
    userSections = (sectionsRes.data ?? []) as SectionRow[];
  }
  const courseLiveSessions = liveSessions.filter(
    (s) => !s.user_note_id && s.course_id
  );
  const activeNoteSessionByNoteId = new Map(
    liveSessions
      .filter(
        (s) =>
          s.user_note_id &&
          (s.status === "recording" || s.status === "paused")
      )
      .map((s) => [s.user_note_id as string, s])
  );
  const tutorSessions = tutorSessionsRaw.filter(
    (s) => typeof s.live_notes_text === "string" && s.live_notes_text.trim()
  );
  const courseNotes = courseNotesRaw.filter(
    (n) => typeof n.content_text === "string" && n.content_text.trim()
  );
  const materialIds = Array.from(
    new Set(
      [...courseNotes, ...trashedCourse]
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
      ...courseLiveSessions.map((s) => s.course_id as string),
      ...trashedLive
        .filter((s) => !s.user_note_id && s.course_id)
        .map((s) => s.course_id as string),
      ...(materials ?? []).map((m) => m.course_id as string),
    ])
  ).filter(Boolean);
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as Array<{ id: string; title: string }> };
  const courseTitleById = new Map(
    (courses ?? []).map((c) => [c.id as string, c.title as string])
  );

  const sectionTitleById = new Map(
    userSections.map((s) => [
      s.id as string,
      ((s.title as string) || "New section").trim() || "New section",
    ])
  );

  const toStandaloneCard = (
    n: (typeof standaloneNotes)[number],
    subtitleOverride?: string | null
  ): NoteDocCardData => {
    const noteId = n.id as string;
    const active = activeNoteSessionByNoteId.get(noteId);
    const activeStatus = active?.status as string | undefined;
    const folderTitle = n.section_id
      ? sectionTitleById.get(n.section_id as string) ?? null
      : null;
    return {
      key: `standalone-${noteId}`,
      href: active
        ? `/notes/doc/${noteId}/record/${active.id as string}`
        : `/notes/doc/${noteId}`,
      title: (n.title as string) || "Untitled note",
      subtitle:
        subtitleOverride !== undefined
          ? subtitleOverride
          : n.ingest_job_id
            ? "Course build started"
            : folderTitle,
      preview: preview(n.content_text),
      searchText: buildNoteSearchText(
        (n.title as string) || "Untitled note",
        n.content_text
      ),
      dateLabel: formatDate(n.updated_at as string),
      ref: { kind: "standalone", id: noteId },
      deletable: true,
      folderSectionId: (n.section_id as string | null) ?? null,
      isLive: activeStatus === "recording",
      chip: activeStatus === "recording"
        ? { label: "Live", tone: "live" as const }
        : activeStatus === "paused"
          ? { label: "Paused", tone: "paused" as const }
          : n.ingest_job_id
            ? { label: "Course", tone: "done" as const }
            : undefined,
    };
  };

  const customSectionCards = (sectionId: string): NoteDocCardData[] =>
    standaloneNotes
      .filter((n) => (n.section_id as string | null) === sectionId)
      .map((n) => toStandaloneCard(n, n.ingest_job_id ? "Course build started" : null));

  const customSectionsBase: NoteHubSection[] = userSections.map((s) => ({
    id: customSectionId(s.id as string),
    title: (s.title as string) || "New section",
    hint: "⋮ on a note in the sidebar → Move to.",
    cards: customSectionCards(s.id as string),
    custom: true,
    emoji:
      typeof (s as { emoji?: string | null }).emoji === "string" &&
      (s as { emoji: string }).emoji.trim()
        ? (s as { emoji: string }).emoji.trim()
        : null,
  }));

  const dedupeCards = (cards: NoteDocCardData[]): NoteDocCardData[] => {
    const seen = new Set<string>();
    const out: NoteDocCardData[] = [];
    for (const card of cards) {
      if (seen.has(card.key)) continue;
      seen.add(card.key);
      out.push(card);
    }
    return out;
  };

  const liveCards: NoteDocCardData[] = courseLiveSessions.map((s) => {
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
      searchText: buildNoteSearchText(
        (s.title as string) || "Live lecture",
        s.notes_text
      ),
      dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
      isLive: isActive,
      chip,
      ref: { kind: "live", id: s.id as string },
      deletable: true,
    };
  });

  const tutorCards: NoteDocCardData[] = tutorSessions.map((s) => {
    const title =
      (s.title as string) || (s.topic as string) || "Tutor session";
    return {
      key: `tutor-${s.id}`,
      href: `/notes/tutor/${s.id}`,
      title,
      subtitle:
        typeof s.topic === "string" && s.topic.trim() ? s.topic.trim() : null,
      preview: preview(s.live_notes_text),
      searchText: buildNoteSearchText(title, s.live_notes_text),
      dateLabel: formatDate((s.started_at as string) ?? (s.updated_at as string)),
      ref: { kind: "tutor", id: s.id as string },
      deletable: true,
    };
  });

  const courseNoteCards: NoteDocCardData[] = courseNotes.map((n) => {
    const material = materialById.get(n.material_id as string);
    const title = materialTitle(material?.file_name);
    return {
      key: `course-${n.material_id}`,
      href: `/notes/material/${n.material_id}`,
      title,
      subtitle: material
        ? (courseTitleById.get(material.course_id) ?? null)
        : null,
      preview: preview(n.content_text),
      searchText: buildNoteSearchText(title, n.content_text),
      dateLabel: formatDate(n.updated_at as string),
      ref: { kind: "course", materialId: n.material_id as string },
      deletable: true,
    };
  });

  const myNotesCards = dedupeCards([
    ...standaloneNotes.map((n) => toStandaloneCard(n)),
    ...liveCards,
    ...tutorCards,
    ...courseNoteCards,
  ]);

  const { data: layoutRow, error: layoutError } = await supabase
    .from("user_notes_hub_layout")
    .select("section_order, section_emojis, note_folders")
    .eq("user_id", user.id)
    .maybeSingle();

  let savedOrder: string[] = [];
  let savedEmojis: Record<string, string> = {};
  let noteFolders: Record<string, string> = {};

  if (layoutError && /note_folders/i.test(layoutError.message ?? "")) {
    const fallback = await supabase
      .from("user_notes_hub_layout")
      .select("section_order, section_emojis")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!fallback.error) {
      if (Array.isArray(fallback.data?.section_order)) {
        savedOrder = fallback.data.section_order as string[];
      }
      if (
        fallback.data?.section_emojis &&
        typeof fallback.data.section_emojis === "object" &&
        !Array.isArray(fallback.data.section_emojis)
      ) {
        savedEmojis = fallback.data.section_emojis as Record<string, string>;
      }
    }
  } else if (layoutError && /section_emojis/i.test(layoutError.message ?? "")) {
    const fallback = await supabase
      .from("user_notes_hub_layout")
      .select("section_order")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!fallback.error && Array.isArray(fallback.data?.section_order)) {
      savedOrder = fallback.data.section_order as string[];
    }
  } else if (!layoutError) {
    if (Array.isArray(layoutRow?.section_order)) {
      savedOrder = layoutRow.section_order as string[];
    }
    if (
      layoutRow?.section_emojis &&
      typeof layoutRow.section_emojis === "object" &&
      !Array.isArray(layoutRow.section_emojis)
    ) {
      savedEmojis = layoutRow.section_emojis as Record<string, string>;
    }
    noteFolders = parseNoteFolders(layoutRow?.note_folders);
  }

  const cardsByKey = new Map(myNotesCards.map((c) => [c.key, c]));
  const customSections: NoteHubSection[] = customSectionsBase.map((section) => {
    const sectionUuid = section.id.startsWith("custom:")
      ? section.id.slice("custom:".length)
      : null;
    if (!sectionUuid) return section;
    const extras: NoteDocCardData[] = [];
    const seen = new Set(section.cards.map((c) => c.key));
    for (const [key, folderId] of Object.entries(noteFolders)) {
      if (folderId !== sectionUuid) continue;
      if (seen.has(key)) continue;
      const card = cardsByKey.get(key);
      if (!card) continue;
      // Standalone already placed via section_id — skip duplicates.
      if (card.ref?.kind === "standalone") continue;
      extras.push({
        ...card,
        folderSectionId: sectionUuid,
      });
      seen.add(key);
    }
    return extras.length
      ? { ...section, cards: [...section.cards, ...extras] }
      : section;
  });

  const trashCards: NoteDocCardData[] = [
    ...trashedStandalone.map((n) => {
      const noteId = n.id as string;
      const deletedAt =
        typeof (n as { deleted_at?: string }).deleted_at === "string"
          ? (n as { deleted_at: string }).deleted_at
          : (n.updated_at as string);
      return {
        key: `standalone-${noteId}`,
        href: `/notes/doc/${noteId}`,
        title: (n.title as string) || "Untitled note",
        subtitle: "In Recently deleted",
        preview: preview(n.content_text),
        searchText: buildNoteSearchText(
          (n.title as string) || "Untitled note",
          n.content_text
        ),
        dateLabel: formatDate(deletedAt),
        ref: { kind: "standalone" as const, id: noteId },
        deletable: true,
        trashed: true,
        chip: { label: "Deleted", tone: "failed" as const },
      };
    }),
    ...trashedLive
      .filter((s) => !s.user_note_id && s.course_id)
      .map((s) => {
        const deletedAt =
          typeof (s as { deleted_at?: string }).deleted_at === "string"
            ? (s as { deleted_at: string }).deleted_at
            : ((s.started_at as string) ?? (s.updated_at as string));
        return {
          key: `live-${s.id}`,
          href: `/dashboard/courses/${s.course_id}/live-notes/${s.id}`,
          title: (s.title as string) || "Live lecture",
          subtitle: "In Recently deleted",
          preview: preview(s.notes_text),
          searchText: buildNoteSearchText(
            (s.title as string) || "Live lecture",
            s.notes_text
          ),
          dateLabel: formatDate(deletedAt),
          ref: { kind: "live" as const, id: s.id as string },
          deletable: true,
          trashed: true,
          chip: { label: "Deleted", tone: "failed" as const },
        };
      }),
    ...trashedTutor.map((s) => {
      const title =
        (s.title as string) || (s.topic as string) || "Tutor session";
      const deletedAt =
        typeof (s as { deleted_at?: string }).deleted_at === "string"
          ? (s as { deleted_at: string }).deleted_at
          : ((s.started_at as string) ?? (s.updated_at as string));
      return {
        key: `tutor-${s.id}`,
        href: `/notes/tutor/${s.id}`,
        title,
        subtitle: "In Recently deleted",
        preview: preview(s.live_notes_text),
        searchText: buildNoteSearchText(title, s.live_notes_text),
        dateLabel: formatDate(deletedAt),
        ref: { kind: "tutor" as const, id: s.id as string },
        deletable: true,
        trashed: true,
        chip: { label: "Deleted", tone: "failed" as const },
      };
    }),
    ...trashedCourse.map((n) => {
      const material = materialById.get(n.material_id as string);
      const title = materialTitle(material?.file_name);
      const deletedAt =
        typeof (n as { deleted_at?: string }).deleted_at === "string"
          ? (n as { deleted_at: string }).deleted_at
          : (n.updated_at as string);
      return {
        key: `course-${n.material_id}`,
        href: `/notes/material/${n.material_id}`,
        title,
        subtitle: "In Recently deleted",
        preview: preview(n.content_text),
        searchText: buildNoteSearchText(title, n.content_text),
        dateLabel: formatDate(deletedAt),
        ref: { kind: "course" as const, materialId: n.material_id as string },
        deletable: true,
        trashed: true,
        chip: { label: "Deleted", tone: "failed" as const },
      };
    }),
  ];

  const sectionsUnordered: NoteHubSection[] = [
    {
      id: "standalone",
      title: "My notes",
      hint: "Everything in one place — folders, live lectures, tutor sessions, and course notes.",
      cards: myNotesCards,
    },
    ...customSections,
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
      id: "trash",
      title: "Recently deleted",
      hint: "Notes you deleted. Restore them, or delete forever.",
      cards: trashCards,
    },
  ];

  const sections = applySectionOrder(sectionsUnordered, savedOrder).map(
    (section) => {
      if (isCustomSection(section)) return section;
      const emoji = savedEmojis[section.id]?.trim();
      return emoji ? { ...section, emoji } : section;
    }
  );

  const empty = sections.every((s) => s.cards.length === 0);

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
