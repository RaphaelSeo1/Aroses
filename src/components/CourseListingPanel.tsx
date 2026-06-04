"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  LISTING_ATTESTATION_ITEMS,
  LISTING_POLICY_SUMMARY,
} from "@/lib/marketplace/attestation";
import { formatPrice } from "@/lib/marketplace/listing-access";
import type { ListingStatus } from "@/lib/marketplace/types";
import { MAX_PRICE_CENTS, MIN_PRICE_CENTS } from "@/lib/marketplace/types";

type ListingState = {
  courseId: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  rejectionReason: string | null;
  qualityReview?: { passed: boolean; score: number; flags: string[] } | null;
  originalityReview?: { flagged: boolean; reasons: string[] } | null;
};

export function CourseListingPanel({
  courseId,
  initialListing,
  hasMaterials,
}: {
  courseId: string;
  initialListing: ListingState | null;
  hasMaterials: boolean;
}) {
  const router = useRouter();
  const [listing, setListing] = useState(initialListing);
  const [priceInput, setPriceInput] = useState(
    initialListing ? (initialListing.priceCents / 100).toFixed(2) : "9.99"
  );
  const [checks, setChecks] = useState([false, false, false]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allChecked = checks.every(Boolean);
  const canEdit =
    !listing ||
    listing.status === "draft" ||
    listing.status === "rejected";

  const saveDraft = useCallback(async () => {
    const dollars = Number.parseFloat(priceInput);
    if (!Number.isFinite(dollars)) {
      setErr("Enter a valid price.");
      return;
    }
    const priceCents = Math.round(dollars * 100);
    if (priceCents < MIN_PRICE_CENTS || priceCents > MAX_PRICE_CENTS) {
      setErr(`Price must be between $0.99 and $99.99.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/listing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceCents }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof json.error === "string" ? json.error : "Could not save.");
        return;
      }
      setListing(json.listing as ListingState);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [courseId, priceInput, router]);

  const submit = useCallback(async () => {
    if (!allChecked) {
      setErr("Accept all attestation statements to continue.");
      return;
    }
    if (!hasMaterials) {
      setErr("Upload at least one study material before listing.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await saveDraft();
      const res = await fetch(`/api/courses/${courseId}/listing/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestationAccepted: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof json.error === "string" ? json.error : "Could not submit.");
        return;
      }
      if (json.listing && typeof json.listing === "object") {
        setListing(json.listing as ListingState);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [allChecked, courseId, hasMaterials, router, saveDraft]);

  const delist = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/listing/delist`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof json.error === "string" ? json.error : "Could not delist.");
        return;
      }
      setListing((l) => (l ? { ...l, status: "draft" } : l));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [courseId, router]);

  const statusLabel =
    listing?.status === "approved"
      ? "Live on marketplace"
      : listing?.status === "pending_review"
        ? "Pending review"
        : listing?.status === "rejected"
          ? "Rejected"
          : "Draft";

  const statusColor =
    listing?.status === "approved"
      ? "text-emerald-700 dark:text-emerald-300"
      : listing?.status === "pending_review"
        ? "text-amber-700 dark:text-amber-300"
        : listing?.status === "rejected"
          ? "text-red-700 dark:text-red-300"
          : "text-zinc-600 dark:text-zinc-400";

  return (
    <div className="mt-10 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
        Sell this course
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {LISTING_POLICY_SUMMARY}
      </p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
        Paid listings and free Explore are mutually exclusive. Buyers pay via
        Stripe; you receive payouts to your connected account.
      </p>

      {listing ? (
        <p className={`mt-4 text-sm font-semibold ${statusColor}`}>
          Status: {statusLabel}
          {listing.status === "approved" && listing.priceCents
            ? ` · ${formatPrice(listing.priceCents, listing.currency)}`
            : null}
        </p>
      ) : null}

      {listing?.status === "rejected" && listing.rejectionReason ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
          {listing.rejectionReason}
        </p>
      ) : null}

      {canEdit ? (
        <>
          <div className="mt-5">
            <label
              htmlFor="listing-price"
              className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
            >
              Price (USD)
            </label>
            <div className="mt-2 flex max-w-xs items-center gap-2">
              <span className="text-zinc-500">$</span>
              <input
                id="listing-price"
                type="number"
                min={0.99}
                max={99.99}
                step={0.01}
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>

          <fieldset className="mt-6 space-y-3">
            <legend className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Seller attestation (required)
            </legend>
            {LISTING_ATTESTATION_ITEMS.map((text, i) => (
              <label
                key={text}
                className="flex cursor-pointer items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) => {
                    const next = [...checks];
                    next[i] = e.target.checked;
                    setChecks(next);
                  }}
                  className="mt-1"
                />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDraft()}
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={busy || !allChecked}
              onClick={() => void submit()}
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Submit for review
            </button>
          </div>
        </>
      ) : null}

      {listing?.status === "approved" ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`/explore/${courseId}`}
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100"
          >
            View marketplace page
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={() => void delist()}
            className="rounded-full border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-200"
          >
            Delist
          </button>
        </div>
      ) : null}

      {err ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}
    </div>
  );
}
