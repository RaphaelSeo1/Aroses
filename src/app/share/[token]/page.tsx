import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CoursePlayer } from "@/components/CoursePlayer";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { APP_NAME } from "@/lib/brand";
import { sortStudyMaterialsForDashboard } from "@/lib/order-study-materials";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveShareToken } from "@/lib/supabase/resolve-share-token";
import type { CoursePayload, SidebarMaterialOutline } from "@/types/course";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ material?: string; module?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const resolved = await resolveShareToken(token);
  if (!resolved) return { title: `Shared course — ${APP_NAME}` };
  const admin = createAdminClient();
  if (!admin) return { title: `Shared course — ${APP_NAME}` };
  const { data } = await admin
    .from("courses")
    .select("title")
    .eq("id", resolved.courseId)
    .maybeSingle();
  return {
    title: data?.title ? `${data.title} — ${APP_NAME}` : `Shared course — ${APP_NAME}`,
  };
}

export default async function ShareViewerPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { material: materialIdParam, module: moduleParam } = await searchParams;

  const resolved = await resolveShareToken(token);
  if (!resolved) notFound();

  const admin = createAdminClient();
  if (!admin) {
    // Should never happen on a configured Vercel deploy; fail soft with notFound.
    notFound();
  }

  // ── Course meta ──────────────────────────────────────────────────────────
  const { data: course } = await admin
    .from("courses")
    .select("id, title, description, is_self_study")
    .eq("id", resolved.courseId)
    .maybeSingle();

  if (!course) notFound();

  // ── Pick the material to show (from ?material= or the first one) ─────────
  const { data: allMaterials } = await admin
    .from("study_materials")
    .select(
      "id, file_name, course_payload, exam_group_id, sort_order, created_at, summary, key_concepts, questions"
    )
    .eq("course_id", course.id);

  const usable = (allMaterials ?? []).filter((m) => {
    const p = m.course_payload as CoursePayload | null;
    return Boolean(p?.modules?.length);
  });

  const { data: groupRows } = await admin
    .from("exam_groups")
    .select("id, name, sort_order")
    .eq("course_id", course.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const groupOrder = (groupRows ?? []).map((g) => g.id);
  const groupNameById = new Map((groupRows ?? []).map((g) => [g.id, g.name]));

  const sorted = sortStudyMaterialsForDashboard(
    usable.map((m) => ({
      id: m.id,
      file_name: m.file_name,
      created_at: m.created_at,
      exam_group_id:
        typeof m.exam_group_id === "string" ? m.exam_group_id : "",
      sort_order: typeof m.sort_order === "number" ? m.sort_order : 0,
      course_payload: m.course_payload ?? undefined,
    })),
    groupOrder
  );

  const targetMaterial =
    sorted.find((m) => m.id === materialIdParam) ?? sorted[0];

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!targetMaterial) {
    return (
      <>
        <AppHeader
          right={
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                Sign up
              </HeaderNavLink>
            </>
          }
        />
        <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Shared via link
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {course.title}
          </h1>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            No lessons have been generated for this course yet.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {`Try ${APP_NAME}`}
          </Link>
        </main>
      </>
    );
  }

  const payload = targetMaterial.course_payload as CoursePayload;

  // ── Sidebar outlines (other materials in this course) ────────────────────
  const sidebarOutlines: SidebarMaterialOutline[] = sorted.map((r) => {
    const p = r.course_payload as CoursePayload;
    const egId =
      typeof r.exam_group_id === "string" && r.exam_group_id
        ? r.exam_group_id
        : undefined;
    return {
      materialId: r.id,
      fileName: displayMaterialSectionLabel(r.file_name),
      modules: p.modules.map((m) => ({ id: m.id, title: m.title })),
      completedModuleIds: [],
      examGroupId: egId,
      examGroupName: egId ? groupNameById.get(egId) ?? undefined : undefined,
    };
  });

  const moduleNum = typeof moduleParam === "string" ? Number(moduleParam) : NaN;
  const initialModuleFromUrl = Number.isFinite(moduleNum) ? moduleNum : undefined;

  const studyBase = `/share/${token}`;

  return (
    <>
      <AppHeader
        right={
          <>
            <HeaderNavLink href="/explore">Explore</HeaderNavLink>
            <HeaderNavLink href="/signup" variant="primary">
              {`Try ${APP_NAME}`}
            </HeaderNavLink>
          </>
        }
      />
      <div className="border-b border-indigo-200/70 bg-indigo-50/50 px-4 py-2.5 dark:border-indigo-900/40 dark:bg-indigo-950/20 sm:px-6">
        <p className="mx-auto flex max-w-7xl items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300">
          <span>🔗</span>
          <span className="font-medium">Shared with you</span>
          <span className="text-indigo-400">·</span>
          <span className="truncate">{course.title}</span>
          <span className="text-indigo-400">·</span>
          <span className="truncate text-indigo-600 dark:text-indigo-400">
            {displayMaterialSectionLabel(targetMaterial.file_name)}
          </span>
        </p>
      </div>
      <CoursePlayer
        key={targetMaterial.id}
        mode="lessons"
        courseId={course.id}
        course={payload}
        materialId={targetMaterial.id}
        sourceLabel={displayMaterialSectionLabel(targetMaterial.file_name)}
        initialCompletedModuleIds={[]}
        sidebarOutlines={sidebarOutlines}
        initialModuleFromUrl={initialModuleFromUrl}
        studyHrefBase={studyBase}
        courseManageEnabled={false}
      />
    </>
  );
}
