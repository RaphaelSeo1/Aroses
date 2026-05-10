import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: `${APP_NAME} — AI study paths from your class material`,
  description: `${APP_NAME} turns your lectures and notes into structured lessons, checkpoints, and quizzes — grounded in what you add.`,
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
        {children}
      </body>
    </html>
  );
}
