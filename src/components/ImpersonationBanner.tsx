/**
 * Persistent view-as chrome. Rendered from the root layout so the
 * impersonated user's UI cannot hide or unmount it.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  return (
    <div
      role="status"
      data-impersonation-banner
      className="fixed inset-x-0 top-0 z-[10000] flex h-10 items-center justify-center gap-3 border-b border-amber-800/40 bg-amber-500 px-3 text-sm font-semibold text-zinc-950 shadow-sm"
    >
      <span className="min-w-0 truncate">
        Viewing as {email}
      </span>
      <form action="/api/admin/impersonate/exit" method="post">
        <button
          type="submit"
          className="shrink-0 rounded-md bg-zinc-950 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-zinc-800"
        >
          Exit
        </button>
      </form>
    </div>
  );
}
