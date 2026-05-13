import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AppAdminNavGate } from "@/components/AppAdminNavGate";
import { ScrollRestoration } from "@/components/ScrollRestoration";
import { ThemeHydration } from "@/components/ThemeHydration";
import { APP_NAME } from "@/lib/brand";
import { THEME_INLINE_SCRIPT } from "@/lib/theme-inline-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${APP_NAME} — Built for the classes that break you`,
  description: `Upload your lecture slides and ${APP_NAME} builds a personalized course — lessons, quizzes, and practice from your actual material. Not generic. Yours.`,
  icons: {
    icon: "/aroses-icon.png",
    apple: "/aroses-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
        <AppAdminNavGate>{children}</AppAdminNavGate>
      </body>
    </html>
  );
}
