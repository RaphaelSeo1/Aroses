import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateKeyInZone } from "@/lib/calendar/dates";
import {
  isValidTimeZone,
  publicStatusFromState,
} from "@/lib/checkin/logic";
import type { CheckInPublicStatus, CheckInState } from "@/lib/checkin/types";

type CheckInRow = {
  last_checkin_date: string;
  last_checkin_at: string;
  timezone: string;
  current_streak: number;
  longest_streak: number;
  total_checkins: number;
  plus_grants: number;
  last_plus_granted_on_date: string | null;
  last_plus_granted_at: string | null;
};

function dateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.slice(0, 10);
}

export function rowToState(row: CheckInRow): CheckInState {
  return {
    lastCheckinDate: dateOnly(row.last_checkin_date) ?? "",
    lastCheckinAt: row.last_checkin_at,
    timezone: row.timezone,
    currentStreak: Number(row.current_streak) || 0,
    longestStreak: Number(row.longest_streak) || 0,
    totalCheckins: Number(row.total_checkins) || 0,
    plusGrants: Number(row.plus_grants) || 0,
    lastPlusGrantedOnDate: dateOnly(row.last_plus_granted_on_date),
    lastPlusGrantedAt: row.last_plus_granted_at,
  };
}

export function stateToRow(userId: string, state: CheckInState) {
  return {
    user_id: userId,
    last_checkin_date: state.lastCheckinDate,
    last_checkin_at: state.lastCheckinAt,
    timezone: state.timezone,
    current_streak: state.currentStreak,
    longest_streak: state.longestStreak,
    total_checkins: state.totalCheckins,
    plus_grants: state.plusGrants,
    last_plus_granted_on_date: state.lastPlusGrantedOnDate,
    last_plus_granted_at: state.lastPlusGrantedAt,
  };
}

export function isMissingCheckInTable(err: { message?: string; code?: string } | null): boolean {
  const msg = err?.message ?? "";
  return (
    err?.code === "42P01" ||
    /user_daily_checkins/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

export async function loadCheckInState(
  client: SupabaseClient,
  userId: string
): Promise<{ state: CheckInState | null; missingTable: boolean }> {
  const { data, error } = await client
    .from("user_daily_checkins")
    .select(
      "last_checkin_date, last_checkin_at, timezone, current_streak, longest_streak, total_checkins, plus_grants, last_plus_granted_on_date, last_plus_granted_at"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingCheckInTable(error)) return { state: null, missingTable: true };
    console.error("[checkin] load failed", error);
    return { state: null, missingTable: false };
  }
  if (!data) return { state: null, missingTable: false };
  return { state: rowToState(data as CheckInRow), missingTable: false };
}

export function emptyPublicStatus(
  now: Date,
  timeZone: string
): CheckInPublicStatus {
  const tz = isValidTimeZone(timeZone) ?? "UTC";
  const today = dateKeyInZone(now, tz);
  return publicStatusFromState(null, today, tz);
}

export async function saveCheckInState(
  admin: SupabaseClient,
  userId: string,
  next: CheckInState,
  prevDate: string | null
): Promise<{ ok: true } | { ok: false; conflict: boolean }> {
  const row = stateToRow(userId, next);
  if (prevDate == null) {
    const { error } = await admin.from("user_daily_checkins").insert(row);
    if (error) {
      if (error.code === "23505") return { ok: false, conflict: true };
      console.error("[checkin] insert failed", error);
      return { ok: false, conflict: false };
    }
    return { ok: true };
  }

  const { data, error } = await admin
    .from("user_daily_checkins")
    .update(row)
    .eq("user_id", userId)
    .eq("last_checkin_date", prevDate)
    .select("user_id")
    .maybeSingle();
  if (error) {
    console.error("[checkin] update failed", error);
    return { ok: false, conflict: false };
  }
  if (!data) return { ok: false, conflict: true };
  return { ok: true };
}

export async function savePlusGrantMarkers(
  admin: SupabaseClient,
  userId: string,
  state: CheckInState
): Promise<boolean> {
  const { error } = await admin
    .from("user_daily_checkins")
    .update({
      plus_grants: state.plusGrants,
      last_plus_granted_on_date: state.lastPlusGrantedOnDate,
      last_plus_granted_at: state.lastPlusGrantedAt,
    })
    .eq("user_id", userId);
  if (error) {
    console.error("[checkin] plus marker update failed", error);
    return false;
  }
  return true;
}
