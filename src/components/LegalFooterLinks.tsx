import Link from "next/link";

/** Inline footer links to legal documents — update `src/lib/legal-contact.ts` for contact email. */
export function LegalFooterLinks({
  className = "",
}: {
  className?: string;
}) {
  const navClass = [
    "flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav className={navClass} aria-label="Legal">
      <Link href="/legal/terms" className="hover:text-brand dark:hover:text-brand-soft">
        Terms of Service
      </Link>
      <Link
        href="/legal/privacy"
        className="hover:text-brand dark:hover:text-brand-soft"
      >
        Privacy Policy
      </Link>
      <Link href="/legal/dmca" className="hover:text-brand dark:hover:text-brand-soft">
        DMCA
      </Link>
    </nav>
  );
}
