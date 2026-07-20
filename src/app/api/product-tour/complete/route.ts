import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Mark the multi-page product tour as finished or skipped. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ product_tour_completed_at: now })
    .eq("id", user.id);

  if (error) {
    const msg = error.message ?? "";
    if (
      error.code === "42703" ||
      /product_tour_completed_at|schema cache/i.test(msg)
    ) {
      return NextResponse.json(
        {
          error:
            "Database is missing product_tour_completed_at. Run supabase/migrations/093_product_tour_completed_at.sql, then try again.",
          code: "schema_migration",
        },
        { status: 503 }
      );
    }
    console.error("[product-tour/complete]", error);
    return NextResponse.json(
      { error: "Could not save tour progress." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, completedAt: now });
}
