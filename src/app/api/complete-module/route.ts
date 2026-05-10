import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CoursePayload } from "@/types/course";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { materialId?: string; moduleId?: number };
  if (typeof b.materialId !== "string" || typeof b.moduleId !== "number") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", b.materialId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = row.course_payload as CoursePayload | null;
  const okModule =
    payload?.modules?.some((m) => m.id === b.moduleId) ?? false;
  if (!okModule) {
    return NextResponse.json({ error: "Invalid module" }, { status: 400 });
  }

  const { error } = await supabase.from("module_completion").upsert({
    user_id: user.id,
    material_id: b.materialId,
    module_id: b.moduleId,
  });

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not save progress." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
