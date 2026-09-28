import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { CourseBuildLive } from "@/components/course-build/CourseBuildLive";
import { UUID_RE } from "@/lib/study-ingest/path";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Course build" };

type Props = {
  params: Promise<{ courseId: string; buildId: string }>;
  searchParams: Promise<{ also?: string }>;
};

export default async function CourseBuildPage({ params, searchParams }: Props) {
  const { courseId, buildId } = await params;
  const { also } = await searchParams;
  if (!UUID_RE.test(courseId) || !UUID_RE.test(buildId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/build/${buildId}`)}`);

  const ids = [buildId, ...(also ?? "").split(",").filter((s) => UUID_RE.test(s))].slice(0, 20);
  const [{ data: builds }, { data: course }] = await Promise.all([
    supabase.from("course_builds").select("id, course_id, created_at").in("id", ids),
    supabase.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
  ]);
  const owned = (builds ?? []).filter((b) => b.course_id === courseId);
  if (!owned.some((b) => b.id === buildId)) notFound();
  const ordered = ids.filter((id) => owned.some((b) => b.id === id));

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        <CourseBuildLive courseId={courseId} courseTitle={course?.title ?? "your course"} buildIds={ordered} />
      </main>
    </>
  );
}
