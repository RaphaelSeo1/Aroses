import { notFound, redirect } from "next/navigation";
import { NotesDocView } from "@/components/notes-hub/NotesDocView";
import { createClient } from "@/lib/supabase/server";

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * Course-material notes in the same full-screen notes chrome as Live Notes.
 * Same document NotesPanel edits inside the immersive learn surface.
 */
export default async function MaterialNotesPage(props: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/notes/material/${materialId}`);
  }

  // RLS scopes visibility (owner + course collaborators).
  const { data: material } = await supabase
    .from("study_materials")
    .select("id, file_name, course_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!material) notFound();

  const [courseRes, notesRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title")
      .eq("id", material.course_id as string)
      .maybeSingle(),
    supabase
      .from("user_course_notes")
      .select("content_json, updated_at")
      .eq("material_id", materialId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const title =
    (material.file_name as string)?.replace(/\.[a-z0-9]{2,5}$/i, "").trim() ||
    "Course notes";
  const courseTitle = (courseRes.data?.title as string) || "Course";

  return (
    <NotesDocView
      notesEndpoint={`/api/mentored/notes/${materialId}`}
      materialId={materialId}
      title={title}
      subtitle={courseTitle}
      kindLabel="Course notes"
      extraAction={{
        href: `/dashboard/courses/${material.course_id}`,
        label: "Open course",
      }}
      initialContentJson={notesRes.data?.content_json ?? EMPTY_DOC}
      initialUpdatedAt={(notesRes.data?.updated_at as string) ?? null}
    />
  );
}
