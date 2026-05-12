import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  isAvatarUrlColumnError,
  isSchoolNameColumnError,
  isStudyFocusColumnError,
  isUsernameColumnError,
} from "@/lib/profile-db-errors";
import { createClient } from "@/lib/supabase/server";
import { parseUsername } from "@/lib/onboarding";

const DISPLAY_MAX = 120;
const BIO_MAX = 500;
const TZ_MAX = 100;
const AVATAR_URL_MAX = 2048;
const SCHOOL_NAME_MAX = 200;
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

function parseAvatarUrl(
  raw: unknown,
  userId: string,
  supabaseUrl: string | undefined
):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "avatar_url must be a string." };
  }
  const t = raw.trim();
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > AVATAR_URL_MAX) {
    return { ok: false, error: "avatar_url is too long." };
  }
  const base = (supabaseUrl ?? "").replace(/\/$/, "");
  if (!base) {
    return { ok: false, error: "Server configuration error." };
  }
  const prefix = `${base}/storage/v1/object/public/avatars/${userId}/`;
  if (!t.startsWith(prefix)) {
    return { ok: false, error: "Invalid avatar_url." };
  }
  return { ok: true, value: t };
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

  type PrevRow = {
    display_name: string | null;
    bio: string | null;
    birthday: string | null;
    timezone: string | null;
    username?: string | null;
    study_focus?: string | null;
    avatar_url?: string | null;
    school_name?: string | null;
  };

  let prev: PrevRow | null = null;

  const sel = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (sel.error) {
    console.error(sel.error);
    return NextResponse.json(
      { error: userFacingSaveError(sel.error) },
      { status: 500 }
    );
  }
  prev = sel.data as PrevRow | null;

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

  let avatarUrl = prev?.avatar_url ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "avatar_url")) {
    const parsed = parseAvatarUrl(
      b.avatar_url,
      user.id,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    );
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    avatarUrl = parsed.value;
  }

  let schoolName = prev?.school_name ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "school_name")) {
    const raw = b.school_name;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "school_name must be a string." },
        { status: 400 }
      );
    }
    const t = typeof raw === "string" ? raw.trim() : "";
    schoolName = t.length === 0 ? null : t.slice(0, SCHOOL_NAME_MAX);
  }

  let username: string | null = prev?.username ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "username")) {
    const raw = b.username;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "username must be a string or null." },
        { status: 400 }
      );
    }
    if (raw === null || raw === "") {
      username = null;
    } else {
      const parsed = parseUsername(raw);
      if (!parsed) {
        return NextResponse.json(
          {
            error:
              "Username must be 3–30 characters: lowercase letters, numbers, and underscores only.",
          },
          { status: 400 }
        );
      }
      const prevNorm =
        prev?.username && typeof prev.username === "string"
          ? parseUsername(prev.username)
          : null;
      if (parsed !== prevNorm) {
        const { data: avail, error: availErr } = await supabase.rpc(
          "profile_username_available",
          { p_username: parsed }
        );
        if (availErr) {
          console.error(availErr);
          return NextResponse.json(
            { error: "Could not verify username. Try again." },
            { status: 503 }
          );
        }
        if (!avail) {
          return NextResponse.json(
            { error: "Username is taken." },
            { status: 409 }
          );
        }
      }
      username = parsed;
    }
  }

  let row: Record<string, unknown> = {
    id: user.id,
    display_name: displayName,
    bio,
    birthday,
    timezone,
    study_focus: studyFocus,
    avatar_url: avatarUrl,
    school_name: schoolName,
    username,
  };

  for (let i = 0; i < 6; i++) {
    const { error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" });
    if (!error) {
      return NextResponse.json({ ok: true });
    }
    if (isStudyFocusColumnError(error.message) && "study_focus" in row) {
      const { study_focus: _sf, ...next } = row;
      row = next;
      continue;
    }
    if (isAvatarUrlColumnError(error.message) && "avatar_url" in row) {
      const { avatar_url: _av, ...next } = row;
      row = next;
      continue;
    }
    if (isSchoolNameColumnError(error.message) && "school_name" in row) {
      const { school_name: _sn, ...next } = row;
      row = next;
      continue;
    }
    if (isUsernameColumnError(error.message) && "username" in row) {
      const { username: _un, ...next } = row;
      row = next;
      continue;
    }
    if (/unique|duplicate|profiles_username_lower_key/i.test(error.message)) {
      return NextResponse.json(
        { error: "Username is taken." },
        { status: 409 }
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: userFacingSaveError(error) },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "Could not save profile after retries." },
    { status: 500 }
  );
}
