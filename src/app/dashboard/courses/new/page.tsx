import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import {
  CourseBuildUpload,
  type BuilderCourse,
  type BuilderPrefill,
} from "@/components/course-build/CourseBuildUpload";
import { getPlanUsageSummary } from "@/lib/billing/plan-usage-summary";
import { readCourseBuildConfig } from "@/lib/course-build/config";
import { UUID_RE } from "@/lib/study-ingest/path";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Build a course" };

type Props = {
  searchParams: Promise<{ course?: string; section?: string; from?: string }>;
};

const FROM_KINDS = {
  note: { kind: "note", table: "user_notes", noun: "Note" },
  live: { kind: "live_session", table: "live_lecture_sessions", noun: "Live lecture" },
  tutor: { kind: "tutor_session", table: "tutor_sessions", noun: "Tutor session" },
} as const;

export default async function NewCoursePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/dashboard/courses/new")}`);

  const [{ data: courseRows }, usage] = await Promise.all([
    supabase.from("courses").select("id, title").eq("user_id", user.id).order("sort_order", { ascending: true }),
    getPlanUsageSummary(user.id, { email: user.email }),
  ]);
  const courseIds = (courseRows ?? []).map((c) => c.id as string);
  const { data: groupRows } = courseIds.length
    ? await supabase
        .from("exam_groups")
        .select("id, name, course_id, sort_order")
        .in("course_id", courseIds)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const courses: BuilderCourse[] = (courseRows ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    sections: (groupRows ?? []).filter((g) => g.course_id === c.id).map((g) => ({ id: g.id, name: g.name })),
  }));

  let initialCourseId = typeof sp.course === "string" && courseIds.includes(sp.course) ? sp.course : null;
  let initialSectionId = typeof sp.section === "string" && UUID_RE.test(sp.section) ? sp.section : null;

  let prefill: BuilderPrefill | null = null;
  const [fromKey, fromId] = (sp.from ?? "").split(":");
  const from = FROM_KINDS[fromKey as keyof typeof FROM_KINDS];
  if (from && fromId && UUID_RE.test(fromId)) {
    const cols = from.kind === "live_session" ? "id, title, course_id, exam_group_id" : "id, title";
    const { data } = await supabase.from(from.table).select(cols).eq("id", fromId).eq("user_id", user.id).maybeSingle();
    const row = data as { id: string; title?: string; course_id?: string; exam_group_id?: string | null } | null;
    if (row) {
      prefill = { kind: from.kind, id: row.id, label: row.title || from.noun };
      if (!initialCourseId && row.course_id && courseIds.includes(row.course_id)) {
        initialCourseId = row.course_id;
        initialSectionId = row.exam_group_id ?? null;
      }
    }
  }

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <CourseBuildUpload
          userId={user.id}
          enabled={readCourseBuildConfig().enabled}
          courses={courses}
          initialCourseId={initialCourseId}
          initialSectionId={initialSectionId}
          prefill={prefill}
          limits={{
            pagesUsed: usage.sourcePagesUsed,
            pagesCap: usage.sourcePagesCap,
            periodEnd: usage.periodEnd,
          }}
        />
      </main>
    </>
  );
}
