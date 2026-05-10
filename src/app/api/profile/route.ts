import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { isStudyFocusColumnError } from "@/lib/profile-db-errors";
import { createClient } from "@/lib/supabase/server";

const DISPLAY_MAX = 120;
const BIO_MAX = 500;
const TZ_MAX = 100;
const STUDY_FOCUS_ALLOWED = new Set([
  "",
  "student",
  "instructor",
  "professional",
  "hobby",
  "other",
]);

function parseBirthday(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T12:00:00.000Z");
  if (Number.isNaN(d.getTime())) return undefined;
  const [y, m, day] = s.split("-").map(Number);
  if (
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() + 1 !== m ||
    d.getUTCDate() !== day
  ) {
    return undefined;
  }
  return s;
}

function userFacingSaveError(err: PostgrestError): string {
  const msg = err.message ?? "";
  const code = err.code ?? "";

  if (
    code === "42P01" ||
    (/relation ["']profiles["']/i.test(msg) && /does not exist/i.test(msg))
  ) {
    return 'Profile table is missing. In Supabase → SQL Editor, run the script from supabase/migrations/014_user_profiles.sql in your repo, then try again.';
  }

  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "Could not save profile (permission denied). Try signing out and back in.";
  }

  if (process.env.NODE_ENV === "development") {
    return `Could not save profile: ${msg || code || "unknown error"}`;
  }

  return "Could not save profile. Check Supabase logs, or run migrations 014_user_profiles.sql and 015_profiles_study_focus.sql.";
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
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

  const b = body as Record<string, unknown>;

  let prev:
    | {
        display_name: string | null;
        bio: string | null;
        birthday: string | null;
        timezone: string | null;
        study_focus?: string | null;
      }
    | null = null;

  const selFull = await supabase
    .from("profiles")
    .select("display_name, bio, birthday, timezone, study_focus")
    .eq("id", user.id)
    .maybeSingle();

  if (selFull.error && isStudyFocusColumnError(selFull.error.message)) {
    const selBase = await supabase
      .from("profiles")
      .select("display_name, bio, birthday, timezone")
      .eq("id", user.id)
      .maybeSingle();
    if (selBase.error) {
      console.error(selBase.error);
      return NextResponse.json(
        { error: userFacingSaveError(selBase.error) },
        { status: 500 }
      );
    }
    prev = selBase.data;
  } else if (selFull.error) {
    console.error(selFull.error);
    return NextResponse.json(
      { error: userFacingSaveError(selFull.error) },
      { status: 500 }
    );
  } else {
    prev = selFull.data;
  }

  let displayName = prev?.display_name ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "display_name")) {
    const raw = b.display_name;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "display_name must be a string." },
        { status: 400 }
      );
    }
    const t = typeof raw === "string" ? raw.trim() : "";
    displayName = t.length === 0 ? null : t.slice(0, DISPLAY_MAX);
  }

  let bio = prev?.bio ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "bio")) {
    const raw = b.bio;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json({ error: "bio must be a string." }, { status: 400 });
    }
    const t = typeof raw === "string" ? raw.trim() : "";
    bio = t.length === 0 ? null : t.slice(0, BIO_MAX);
  }

  let timezone = prev?.timezone ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "timezone")) {
    const raw = b.timezone;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "timezone must be a string." },
        { status: 400 }
      );
    }
    const t = typeof raw === "string" ? raw.trim() : "";
    timezone = t.length === 0 ? null : t.slice(0, TZ_MAX);
  }

  let birthday: string | null =
    prev?.birthday != null ? String(prev.birthday).slice(0, 10) : null;
  if (Object.prototype.hasOwnProperty.call(b, "birthday")) {
    const parsed = parseBirthday(b.birthday);
    if (parsed === undefined) {
      return NextResponse.json(
        { error: "birthday must be YYYY-MM-DD or empty." },
        { status: 400 }
      );
    }
    birthday = parsed;
  }

  let studyFocus = prev?.study_focus ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "study_focus")) {
    const raw = b.study_focus;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "study_focus must be a string." },
        { status: 400 }
      );
    }
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!STUDY_FOCUS_ALLOWED.has(key)) {
      return NextResponse.json(
        { error: "Invalid study_focus value." },
        { status: 400 }
      );
    }
    studyFocus = key.length === 0 ? null : key;
  }

  const baseRow = {
    id: user.id,
    display_name: displayName,
    bio,
    birthday,
    timezone,
  };

  const withStudy = { ...baseRow, study_focus: studyFocus };

  let { error } = await supabase
    .from("profiles")
    .upsert(withStudy, { onConflict: "id" });

  if (
    error &&
    (error.code === "42703" || isStudyFocusColumnError(error.message))
  ) {
    ({ error } = await supabase
      .from("profiles")
      .upsert(baseRow, { onConflict: "id" }));
  }

  if (error) {
    console.error(error);
    return NextResponse.json(
      { error: userFacingSaveError(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
