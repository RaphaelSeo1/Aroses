import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Brand assets — ${APP_NAME}`,
  description: `Download the ${APP_NAME} logo and icon (black wordmark, SVG and PNG).`,
};

const ASSETS = [
  {
    name: "Full logo — black text (PNG)",
    desc: "Icon + “Aroses” in black with tagline. Best for light backgrounds.",
    href: "/aroses-logo.png",
    ext: "PNG",
  },
  {
    name: "Full logo — black text (SVG)",
    desc: "Same lockup as vector — scales cleanly for print and slides.",
    href: "/aroses-logo-black-text.svg",
    ext: "SVG",
  },
  {
    name: "Header wordmark (SVG)",
    desc: "Icon + “Aroses” only — matches the site nav, no tagline.",
    href: "/aroses-wordmark-header.svg",
    ext: "SVG",
  },
  {
    name: "App icon (PNG)",
    desc: "Square badge only — favicon and profile-style uses.",
    href: "/aroses-icon.png",
    ext: "PNG",
  },
  {
    name: "Logo — white text (SVG)",
    desc: "For dark backgrounds (presentations, video overlays).",
    href: "/aroses-logo-white-text.svg",
    ext: "SVG",
  },
  {
    name: "Wordmark — no tagline (PNG)",
    desc: "Icon + white “Aroses” on transparent-style dark export.",
    href: "/aroses-brand-notag.png",
    ext: "PNG",
  },
] as const;

export default function BrandAssetsPage() {
  return (
    <>
      <AppHeader
        right={
          <>
            <HeaderNavLink href="/help">Help</HeaderNavLink>
            <HeaderNavLink href="/intro">Home</HeaderNavLink>
          </>
        }
      />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Brand assets
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Download the {APP_NAME} logo with the same black serif wordmark as the
          site header. Right-click any file → Save, or use the download links
          below.
        </p>

        <ul className="mt-8 space-y-4">
          {ASSETS.map((a) => (
            <li
              key={a.href}
              className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {a.name}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {a.desc}
                  </p>
                </div>
                <a
                  href={a.href}
                  download
                  className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
                >
                  Download {a.ext}
                </a>
              </div>
              {a.href.endsWith(".svg") || a.href.endsWith(".png") ? (
                <div className="mt-4 flex items-center justify-center rounded-xl bg-zinc-50 p-6 dark:bg-zinc-900/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.href}
                    alt=""
                    className="max-h-24 max-w-full object-contain"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-8 text-xs text-zinc-500">
          <Link href="/intro" className="text-brand hover:underline">
            ← Back to {APP_NAME}
          </Link>
        </p>
        <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <LegalFooterLinks />
        </div>
      </main>
    </>
  );
}
