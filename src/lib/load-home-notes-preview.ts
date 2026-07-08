import type { SupabaseClient } from "@supabase/supabase-js";

export type HomeNotePreviewItem = {
  id: string;
  href: string;
  title: string;
  subtitle: string | null;
  preview: string | null;
  updatedAt: string;
  source: "live" | "tutor" | "course" | "lesson";
  status?: "recording" | "paused" | "completed" | "failed";
};

function previewText(text: unknown, max = 220): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function materialTitle(fileName: string | null | undefined): string {
  if (!fileName) return "Course material";
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || fileName;
}

/**
 * Recent notes across live lectures, tutor sessions, mentored course docs,
 * and self-study lesson notes — sorted by last update for the home preview.
 */
export async function loadHomeNotesPreview(
  supabase: SupabaseClient,
  userId: string,
  limit = 6
): Promise<HomeNotePreviewItem[]> {
  const [liveRes, tutorRes, courseNotesRes, lessonNotesRes] = await Promise.all([
    supabase
      .from("live_lecture_sessions")
      .select("id, course_id, title, status, updated_at, notes_text")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("tutor_sessions")
      .select("id, title, topic, updated_at, live_notes_text")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("user_course_notes")
      .select("material_id, content_text, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("user_lesson_notes")
      .select("material_id, note_body, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const liveSessions = liveRes.data ?? [];
  const items: HomeNotePreviewItem[] = [];

  for (const s of liveSessions) {
    const p = previewText(s.notes_text);
    if (!p && s.status !== "recording" && s.status !== "paused") continue;
    items.push({
      id: `live-${s.id}`,
      href: `/dashboard/courses/${s.course_id}/live-notes/${s.id}`,
      title: (s.title as string) || "Live lecture",
      subtitle: null,
      preview: p,
      updatedAt: (s.updated_at as string) ?? new Date().toISOString(),
      source: "live",
      status: s.status as HomeNotePreviewItem["status"],
    });
  }

  for (const s of tutorRes.data ?? []) {
    const p = previewText(s.live_notes_text);
    if (!p) continue;
    items.push({
      id: `tutor-${s.id}`,
      href: `/notes/tutor/${s.id}`,
      title: (s.title as string) || (s.topic as string) || "Tutor session",
      subtitle: typeof s.topic === "string" ? s.topic.trim() || null : null,
      preview: p,
      updatedAt: (s.updated_at as string) ?? new Date().toISOString(),
      source: "tutor",
    });
  }

  for (const n of courseNotesRes.data ?? []) {
    const p = previewText(n.content_text);
    if (!p) continue;
    items.push({
      id: `course-${n.material_id}`,
      href: `/notes/material/${n.material_id}`,
      title: "Course notes",
      subtitle: null,
      preview: p,
      updatedAt: (n.updated_at as string) ?? new Date().toISOString(),
      source: "course",
    });
  }

  const lessonByMaterial = new Map<
    string,
    { preview: string; updatedAt: string }
  >();
  for (const n of lessonNotesRes.data ?? []) {
    const id = n.material_id as string;
    const p = previewText(n.note_body, 160);
    if (!p) continue;
    const updatedAt = (n.updated_at as string) ?? "";
    const existing = lessonByMaterial.get(id);
    if (!existing || updatedAt > existing.updatedAt) {
      lessonByMaterial.set(id, { preview: p, updatedAt });
    }
  }
  for (const [materialId, g] of lessonByMaterial) {
    items.push({
      id: `lesson-${materialId}`,
      href: `/notes`,
      title: "Lesson notes",
      subtitle: null,
      preview: g.preview,
      updatedAt: g.updatedAt,
      source: "lesson",
    });
  }

  const top = items
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, limit);

  const materialIds = new Set<string>();
  const courseIds = new Set<string>();

  for (const item of top) {
    if (item.source === "course" || item.source === "lesson") {
      materialIds.add(item.id.replace(/^(course|lesson)-/, ""));
    }
    if (item.source === "live") {
      const live = liveSessions.find((s) => `live-${s.id}` === item.id);
      if (live?.course_id) courseIds.add(live.course_id as string);
    }
  }

  const [{ data: materials }] = await Promise.all([
    materialIds.size
      ? supabase
          .from("study_materials")
          .select("id, file_name, course_id")
          .in("id", Array.from(materialIds))
      : Promise.resolve({ data: [] as Array<{ id: string; file_name: string; course_id: string }> }),
  ]);

  for (const m of materials ?? []) {
    courseIds.add(m.course_id as string);
  }

  const { data: courses } = courseIds.size
    ? await supabase.from("courses").select("id, title").in("id", Array.from(courseIds))
    : { data: [] as Array<{ id: string; title: string }> };

  const materialById = new Map(
    (materials ?? []).map((m) => [m.id as string, m])
  );
  const courseTitleById = new Map(
    (courses ?? []).map((c) => [c.id as string, c.title as string])
  );

  for (const item of top) {
    if (item.source === "course" || item.source === "lesson") {
      const materialId = item.id.replace(/^(course|lesson)-/, "");
      const m = materialById.get(materialId);
      if (m) {
        if (item.source === "course") {
          item.title = materialTitle(m.file_name);
        } else {
          item.title = materialTitle(m.file_name);
          item.href = `/dashboard/courses/${m.course_id}/study`;
        }
        item.subtitle = courseTitleById.get(m.course_id) ?? null;
      }
    } else if (item.source === "live") {
      const live = liveSessions.find((s) => `live-${s.id}` === item.id);
      if (live?.course_id) {
        item.subtitle = courseTitleById.get(live.course_id as string) ?? null;
      }
    }
  }

  return top;
}
