import { NextResponse } from "next/server";
import {
  BUILTIN_HUB_SECTION_IDS,
  isValidSectionOrder,
} from "@/lib/notes/hub-layout";
import { createClient } from "@/lib/supabase/server";

const MAX_SECTIONS = 60;
const BUILTIN_IDS = new Set<string>(BUILTIN_HUB_SECTION_IDS);

function normalizeEmoji(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, 16);
  return trimmed || null;
}

/**
 * GET /api/notes/hub-layout — saved sidebar section order + built-in emojis.
 * PATCH — persist order and/or a built-in section emoji.
 * Body: { order?: string[], emojiUpdate?: { id: string, emoji: string } }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_notes_hub_layout")
    .select("section_order, section_emojis")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Migration 087 may not be applied — fall back to order only.
    if (/section_emojis/i.test(error.message ?? "")) {
      const fallback = await supabase
        .from("user_notes_hub_layout")
        .select("section_order")
        .eq("user_id", user.id)
        .maybeSingle();
      if (fallback.error) {
        console.error("[notes hub-layout GET]", fallback.error);
        return NextResponse.json(
          { error: "Could not load layout." },
          { status: 500 }
        );
      }
      const order = Array.isArray(fallback.data?.section_order)
        ? (fallback.data.section_order as string[])
        : [];
      return NextResponse.json({ order, emojis: {} });
    }
    console.error("[notes hub-layout GET]", error);
    return NextResponse.json({ error: "Could not load layout." }, { status: 500 });
  }

  const order = Array.isArray(data?.section_order)
    ? (data.section_order as string[])
    : [];
  const emojis =
    data?.section_emojis &&
    typeof data.section_emojis === "object" &&
    !Array.isArray(data.section_emojis)
      ? (data.section_emojis as Record<string, string>)
      : {};

  return NextResponse.json({ order, emojis });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    order?: unknown;
    emojiUpdate?: { id?: unknown; emoji?: unknown };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hasOrder = Array.isArray(body.order);
  const hasEmoji =
    body.emojiUpdate != null && typeof body.emojiUpdate === "object";

  if (!hasOrder && !hasEmoji) {
    return NextResponse.json(
      { error: "order or emojiUpdate required" },
      { status: 400 }
    );
  }

  let order: string[] | undefined;
  if (hasOrder) {
    order = (body.order as unknown[])
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, MAX_SECTIONS);

    const [{ data: customSections }, layoutRes] = await Promise.all([
      supabase
        .from("user_note_sections")
        .select("id")
        .eq("user_id", user.id),
      supabase
        .from("user_notes_hub_layout")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const customIds = (customSections ?? []).map(
      (s) => `custom:${s.id as string}`
    );
    const allowed = new Set([
      "standalone",
      "live",
      "tutor",
      "course",
      ...customIds,
    ]);

    if (!isValidSectionOrder(order, allowed)) {
      return NextResponse.json({ error: "Invalid section order." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error } = layoutRes.data
      ? await supabase
          .from("user_notes_hub_layout")
          .update({ section_order: order, updated_at: now })
          .eq("user_id", user.id)
      : await supabase.from("user_notes_hub_layout").insert({
          user_id: user.id,
          section_order: order,
          updated_at: now,
        });

    if (error) {
      console.error("[notes hub-layout PATCH order]", error);
      return NextResponse.json({ error: "Could not save layout." }, { status: 500 });
    }
  }

  let emojis: Record<string, string> | undefined;
  if (hasEmoji) {
    const id =
      typeof body.emojiUpdate?.id === "string"
        ? body.emojiUpdate.id.trim()
        : "";
    const emoji = normalizeEmoji(body.emojiUpdate?.emoji);
    if (!id || !BUILTIN_IDS.has(id)) {
      return NextResponse.json(
        { error: "emojiUpdate.id must be a built-in section id" },
        { status: 400 }
      );
    }
    if (emoji === undefined || emoji === null) {
      return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
    }

    const { data: existing, error: loadError } = await supabase
      .from("user_notes_hub_layout")
      .select("section_order, section_emojis")
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadError && /section_emojis/i.test(loadError.message ?? "")) {
      return NextResponse.json(
        {
          error:
            "Could not save emoji. Apply migration 087_user_notes_hub_layout_emojis.sql in Supabase.",
        },
        { status: 503 }
      );
    }
    if (loadError) {
      console.error("[notes hub-layout PATCH emoji load]", loadError);
      return NextResponse.json({ error: "Could not save emoji." }, { status: 500 });
    }

    const prev =
      existing?.section_emojis &&
      typeof existing.section_emojis === "object" &&
      !Array.isArray(existing.section_emojis)
        ? { ...(existing.section_emojis as Record<string, string>) }
        : {};
    prev[id] = emoji;
    emojis = prev;

    const now = new Date().toISOString();
    const { error } = existing
      ? await supabase
          .from("user_notes_hub_layout")
          .update({ section_emojis: prev, updated_at: now })
          .eq("user_id", user.id)
      : await supabase.from("user_notes_hub_layout").insert({
          user_id: user.id,
          section_order: [],
          section_emojis: prev,
          updated_at: now,
        });

    if (error) {
      if (/section_emojis/i.test(error.message ?? "")) {
        return NextResponse.json(
          {
            error:
              "Could not save emoji. Apply migration 087_user_notes_hub_layout_emojis.sql in Supabase.",
          },
          { status: 503 }
        );
      }
      console.error("[notes hub-layout PATCH emoji]", error);
      return NextResponse.json({ error: "Could not save emoji." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    ...(order ? { order } : {}),
    ...(emojis ? { emojis } : {}),
  });
}
