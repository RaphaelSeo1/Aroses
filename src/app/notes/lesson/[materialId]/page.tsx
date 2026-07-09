import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

type CoursePayload = {
  modules?: Array<{
    id?: number;
    title?: string;
    lessons?: Array<{ title?: string }>;
  }>;
};

function materialTitle(fileName: string | null | undefined): string {
  if (!fileName) return "Course material";
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || fileName;
}

function lessonLabel(
  payload: CoursePayload | null,
  moduleId: number,
  lessonIndex: number
): string {
  const mod = payload?.modules?.find((m) => m.id === moduleId);
  const lessonTitle = mod?.lessons?.[lessonIndex]?.title?.trim();
  const modTitle = mod?.title?.trim();
  if (modTitle && lessonTitle) return `${modTitle} · ${lessonTitle}`;
  if (lessonTitle) return lessonTitle;
  if (modTitle) return `${modTitle} · Lesson ${lessonIndex + 1}`;
  return `Module ${moduleId + 1} · Lesson ${lessonIndex + 1}`;
}

function formatHighlight(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  return raw
    .replace(/^\[(Pink|Yellow|Blue|Green|Purple) highlight[^\]]*\]\s*/i, "")
    .trim();
}

export default async function LessonNotesMaterialPage(props: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/notes/lesson/${materialId}`);
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) notFound();

  const { data: material } = await supabase
    .from("study_materials")
    .select("id, file_name, course_id, course_payload")
    .eq("id", materialId)
    .maybeSingle();
  if (!material) notFound();

  const { data: notes } = await supabase
    .from("user_lesson_notes")
    .select("id, module_id, lesson_index, highlight_excerpt, note_body, updated_at")
    .eq("user_id", user.id)
    .eq("material_id", materialId)
    .order("module_id", { ascending: true })
    .order("lesson_index", { ascending: true })
    .order("updated_at", { ascending: true });

  const { data: course } = await supabase
    .from("courses")
    .select("title")
    .eq("id", material.course_id as string)
    .maybeSingle();

  const payload = (material.course_payload ?? null) as CoursePayload | null;
  const title = materialTitle(material.file_name as string);
  const courseTitle = (course?.title as string) || "Course";
  const rows = notes ?? [];

  const grouped = new Map<
    string,
    {
      moduleId: number;
      lessonIndex: number;
      label: string;
      items: typeof rows;
    }
  >();
  for (const n of rows) {
    const moduleId = n.module_id as number;
    const lessonIndex = n.lesson_index as number;
    const key = `${moduleId}:${lessonIndex}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        moduleId,
        lessonIndex,
        label: lessonLabel(payload, moduleId, lessonIndex),
        items: [],
      });
    }
    grouped.get(key)!.items.push(n);
  }

  const studyBase = `/dashboard/courses/${material.course_id}/study?material=${materialId}`;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
          <Link
            href="/notes"
            className="text-xs font-medium text-zinc-500 hover:text-violet-700 dark:hover:text-violet-300"
          >
            ← All notes
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Lesson notes · {courseTitle}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            Highlights and short notes you captured while reading lessons in
            self-study — not the full running notes doc from mentored learning.
          </p>
          <Link
            href={studyBase}
            className="mt-4 inline-flex rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Open material in study
          </Link>

          {rows.length === 0 ? (
            <p className="mt-10 text-sm text-zinc-500">
              No lesson notes for this material yet. Highlight text while
              studying to add notes here.
            </p>
          ) : (
            <div className="mt-10 space-y-10">
              {Array.from(grouped.values()).map((group) => (
                <section key={`${group.moduleId}-${group.lessonIndex}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {group.label}
                    </h2>
                    <Link
                      href={`${studyBase}&module=${group.moduleId}&lesson=${group.lessonIndex}`}
                      className="text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
                    >
                      Go to lesson →
                    </Link>
                  </div>
                  <ul className="mt-3 space-y-3">
                    {group.items.map((n) => {
                      const highlight = formatHighlight(
                        n.highlight_excerpt as string | null
                      );
                      return (
                        <li
                          key={n.id as string}
                          className="rounded-2xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90"
                        >
                          {highlight ? (
                            <p className="border-l-2 border-amber-300 pl-3 text-xs italic leading-relaxed text-zinc-600 dark:border-amber-600 dark:text-zinc-400">
                              &ldquo;{highlight}&rdquo;
                            </p>
                          ) : null}
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                            {(n.note_body as string)?.trim() || "(empty note)"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
