import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${APP_NAME} is paused`,
  robots: { index: false, follow: false },
};

export default function PausedPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-medium tracking-wide text-rose-700 dark:text-rose-300">
          {APP_NAME}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Aroses is paused
        </h1>
        <p className="mt-4 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          The site is closed while we work on it. It will be back soon.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-full bg-rose-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-rose-800"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
