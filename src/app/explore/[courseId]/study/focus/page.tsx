import { notFound, redirect } from "next/navigation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ material?: string; module?: string }>;
};

/** Legacy URL: `/study/focus` → `/study/quiz?practice=focus`. */
export default async function ExploreStudyFocusRedirect({
  params,
  searchParams,
}: Props) {
  const { courseId } = await params;
  const sp = await searchParams;

  if (!UUID_RE.test(courseId)) notFound();

  const qs = new URLSearchParams();
  if (typeof sp.material === "string") qs.set("material", sp.material);
  if (typeof sp.module === "string") qs.set("module", sp.module);
  qs.set("practice", "focus");

  redirect(`/explore/${courseId}/study/quiz?${qs.toString()}`);
}
