"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPrice } from "@/lib/marketplace/listing-access";

export type PendingListingRow = {
  course_id: string;
  price_cents: number;
  currency: string;
  submitted_at: string | null;
  quality_review: {
    passed?: boolean;
    score?: number;
    flags?: string[];
    summary?: string;
  } | null;
  originality_review: {
    flagged?: boolean;
    reasons?: string[];
  } | null;
  courses: {
    title: string;
    user_id: string;
  } | null;
  seller_label: string;
};

export function AdminPendingListings({
  listings,
}: {
  listings: PendingListingRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function approve(courseId: string) {
    setBusyId(courseId);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/listings/${courseId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErr(typeof json.error === "string" ? json.error : "Approve failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(courseId: string) {
    if (rejectReason.trim().length < 8) {
      setErr("Rejection reason must be at least 8 characters.");
      return;
    }
    setBusyId(courseId);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/listings/${courseId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErr(typeof json.error === "string" ? json.error : "Reject failed.");
        return;
      }
      setRejectId(null);
      setRejectReason("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (listings.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No listings pending review.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {err ? (
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}
      <ul className="space-y-4">
        {listings.map((row) => {
          const title = row.courses?.title ?? "Untitled";
          const quality = row.quality_review;
          const originality = row.originality_review;
          return (
            <li
              key={row.course_id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {title}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatPrice(row.price_cents, row.currency)} · Seller:{" "}
                    {row.seller_label}
                  </p>
                  {quality ? (
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      Quality: score {quality.score ?? "—"}
                      {quality.passed ? " (pass)" : " (fail)"}
                      {quality.flags?.length
                        ? ` — ${quality.flags.join("; ")}`
                        : ""}
                    </p>
                  ) : null}
                  {originality?.flagged ? (
                    <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                      Copyright flag:{" "}
                      {(originality.reasons ?? []).join("; ") || "review content"}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/dashboard/courses/${row.course_id}`}
                    className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
                  >
                    Open course
                  </a>
                  <button
                    type="button"
                    disabled={busyId === row.course_id}
                    onClick={() => void approve(row.course_id)}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.course_id}
                    onClick={() => {
                      setRejectId(row.course_id);
                      setRejectReason("");
                    }}
                    className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-800 dark:border-red-800 dark:text-red-200"
                  >
                    Reject
                  </button>
                </div>
              </div>
              {rejectId === row.course_id ? (
                <div className="mt-4 space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason (shown to seller)"
                    rows={3}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    disabled={busyId === row.course_id}
                    onClick={() => void reject(row.course_id)}
                    className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Confirm reject
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
