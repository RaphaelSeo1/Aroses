import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";

export default function NewCoursePage() {
  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="mx-auto w-full max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Course building is paused
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Creating a course from uploads, notes, or a tutor session is turned
          off while the builder is replaced. Courses you already have, mentored
          learning, notes, and live notes still work.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex text-sm font-semibold text-violet-700 hover:text-violet-800 dark:text-violet-300"
        >
          Back to dashboard
        </Link>
      </main>
    </>
  );
}
