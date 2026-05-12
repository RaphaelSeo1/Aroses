import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const qs = new URLSearchParams();
  if (typeof sp.material === "string" && UUID_RE.test(sp.material)) {
    qs.set("material", sp.material);
  }
  if (typeof sp.module === "string" && sp.module.trim().length > 0) {
    qs.set("module", sp.module.trim());
  }
  qs.set("practice", "focus");

  const quizUrl = `/explore/${courseId}/study/quiz?${qs.toString()}`;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(quizUrl)}`);
  }

  redirect(quizUrl);
}
