import Link from "next/link";
import {
  AppHeader,
  HEADER_NAV_NEUTRAL,
  HEADER_NAV_PRIMARY,
} from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: `Explore — ${APP_NAME}`,
  description:
    "Browse community-shared courses: titles and descriptions from other learners.",
};

export default async function ExplorePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id, title, description, created_at, user_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(200);

  const exploreBroken = Boolean(
    coursesError &&
      (coursesError.code === "42703" ||
        /is_public|schema cache/i.test(coursesError.message ?? ""))
  );

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedIn />
          ) : (
            <>
              <Link href="/login" className={HEADER_NAV_NEUTRAL}>
                Log in
              </Link>
              <Link href="/signup" className={HEADER_NAV_PRIMARY}>
                Sign up
              </Link>
            </>
          )
        }
      />
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Community
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Explore courses
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Courses stay private until you open a course&apos;s workspace and turn
            on listing — visiting this page does not publish anything. Open a
            listing to read its title and description only.
          </p>

          {exploreBroken ? (
            <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-medium">Explore needs a quick database update</p>
              <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                Run{" "}
                <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                  supabase/migrations/007_public_courses.sql
                </code>{" "}
                in the Supabase SQL Editor (adds{" "}
                <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                  is_public
                </code>{" "}
                and read access for public listings). Then reload this page.
              </p>
            </div>
          ) : coursesError ? (
            <p className="mt-12 text-sm text-red-600 dark:text-red-400">
              Could not load listings. Try again in a moment.
            </p>
          ) : !courses || courses.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">
                Nothing listed yet
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Each course is private until you enable it: open{" "}
                <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                  My courses
                </strong>
                , choose a course, then check{" "}
                <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Show this course on Explore
                </strong>{" "}
                under Public Explore listing.
              </p>
              <Link
                href={user ? "/dashboard" : "/signup"}
                className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover dark:bg-brand"
              >
                {user ? "Go to My courses" : "Get started"}
              </Link>
            </div>
          ) : (
            <ul className="mt-12 space-y-4">
              {courses.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/explore/${c.id}`}
                    className="block rounded-2xl border border-zinc-200/90 bg-white/95 p-6 shadow-sm transition hover:border-brand-border hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/95 dark:hover:border-brand-border/50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        {c.title}
                      </h2>
                      {user && user.id === c.user_id ? (
                        <span className="rounded-full bg-brand-blush px-2.5 py-0.5 text-xs font-medium text-brand-ink dark:bg-[#1e1616] dark:text-brand-soft">
                          Your listing
                        </span>
                      ) : null}
                    </div>
                    {c.description ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {c.description}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm italic text-zinc-500">
                        No description
                      </p>
                    )}
                    <p className="mt-4 text-xs text-zinc-500">
                      Listed{" "}
                      {new Date(c.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
