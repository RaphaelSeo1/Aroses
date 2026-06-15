import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";
import Script from "next/script";
import { ActivePdfBuildProvider } from "@/components/ActivePdfBuildProvider";
import { AppAdminNavGate } from "@/components/AppAdminNavGate";
import { AppDialogs } from "@/components/AppDialogs";
import { ScrollRestoration } from "@/components/ScrollRestoration";
import { ThemeHydration } from "@/components/ThemeHydration";
import { APP_NAME } from "@/lib/brand";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { getUiLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/locales";
import { getPublicSiteOrigin } from "@/lib/site-url";
import { THEME_INLINE_SCRIPT } from "@/lib/theme-inline-script";
import "./globals.css";

const siteUrl = getPublicSiteOrigin() || "https://aroses.app";
const defaultTitle = `${APP_NAME} — Built for the classes that break you`;
const defaultDescription = `Upload your lecture slides and ${APP_NAME} builds a personalized course — lessons, quizzes, and practice from your actual material. Not generic. Yours.`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Korean glyph fallback — Geist is latin-only, so Korean UI text falls
 * through to Noto Sans KR (loaded on demand via unicode-range slices).
 */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: defaultTitle,
  description: defaultDescription,
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: siteUrl,
    siteName: APP_NAME,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
  },
  // Google Search reads /favicon.ico first; the repo still had the default
  // Create Next App icon until we replaced it. Explicit 48×48 helps crawlers.
  icons: {
    icon: [
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/aroses-icon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getUiLocale();
  const dict = getDictionary(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansKr.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INLINE_SCRIPT}
        </Script>
        <Script id="scroll-restoration-init" strategy="beforeInteractive">
          {
            "try{if(typeof history!==\"undefined\"&&\"scrollRestoration\"in history){history.scrollRestoration=\"manual\";}}catch(e){}"
          }
        </Script>
        <ScrollRestoration />
        <ThemeHydration />
        <LocaleProvider locale={locale} dict={dict}>
          <ActivePdfBuildProvider>
            <AppAdminNavGate>{children}</AppAdminNavGate>
          </ActivePdfBuildProvider>
          <AppDialogs />
        </LocaleProvider>
        <Analytics />
      </body>
    </html>
  );
}
