import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveTourCourse } from "@/lib/product-tour/resolve-tour-course";

/** Signed-in helper: which Explore course the onboarding tour should open. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const course = await resolveTourCourse(supabase);
  return NextResponse.json({
    id: course.id,
    title: course.title,
    available: course.available,
  });
}
