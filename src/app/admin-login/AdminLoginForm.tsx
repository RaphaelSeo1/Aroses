"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: signError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signError || !data.user) {
      setLoading(false);
      setError(signError?.message ?? "Could not sign in.");
      return;
    }
    if (!isAppAdminEnvUser({ id: data.user.id, email: data.user.email })) {
      await supabase.auth.signOut();
      setLoading(false);
      setError("This login is only for the admin account.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Admin login</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          Enter your email and password to open the site.
        </p>
        <label htmlFor="admin-email" className="mt-8 block text-sm font-medium">
          Email
        </label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <label
          htmlFor="admin-password"
          className="mt-5 block text-sm font-medium"
        >
          Password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {error ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 flex w-full justify-center rounded-full bg-rose-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
