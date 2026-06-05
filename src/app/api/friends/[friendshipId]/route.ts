import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ friendshipId: string }> };

/** PATCH — accept, decline, or block. */
export async function PATCH(request: Request, ctx: Params) {
  const { friendshipId } = await ctx.params;
  if (!UUID_RE.test(friendshipId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const action = (body as { action?: unknown }).action;
  const now = new Date().toISOString();

  const { data: row } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .eq("id", friendshipId)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isParty = row.requester_id === user.id || row.addressee_id === user.id;
  if (!isParty) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  if (action === "accept") {
    if (row.addressee_id !== user.id || row.status !== "pending") {
      return NextResponse.json({ error: "Cannot accept this request." }, { status: 400 });
    }
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted", accepted_at: now, updated_at: now })
      .eq("id", friendshipId);
    if (error) {
      console.error("[friends accept]", error);
      return NextResponse.json({ error: "Could not accept." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "decline") {
    if (row.addressee_id !== user.id || row.status !== "pending") {
      return NextResponse.json({ error: "Cannot decline this request." }, { status: 400 });
    }
    const { error } = await supabase
      .from("friendships")
      .update({ status: "declined", updated_at: now })
      .eq("id", friendshipId);
    if (error) {
      return NextResponse.json({ error: "Could not decline." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "block") {
    const { error } = await supabase
      .from("friendships")
      .update({
        status: "blocked",
        blocked_by: user.id,
        updated_at: now,
      })
      .eq("id", friendshipId);
    if (error) {
      return NextResponse.json({ error: "Could not block." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}

/** DELETE — remove friend or cancel outgoing request. */
export async function DELETE(_request: Request, ctx: Params) {
  const { friendshipId } = await ctx.params;
  if (!UUID_RE.test(friendshipId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: row } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id")
    .eq("id", friendshipId)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (row.requester_id !== user.id && row.addressee_id !== user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) {
    console.error("[friends DELETE]", error);
    return NextResponse.json({ error: "Could not remove." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
