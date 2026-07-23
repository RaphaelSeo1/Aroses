import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { Reveal } from "@/components/Reveal";
import { ScrollTypewriter } from "@/components/ScrollTypewriter";
import { APP_NAME } from "@/lib/brand";
import { tf } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import type { Dictionary } from "@/locales";

type LandingDict = Dictionary["landing"];

// === SVG icons =================================================================

function IconMic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 10a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <polyline points="9 12 11 14 15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCards({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="6" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6V4a2 2 0 012-2h12a2 2 0 012 2v11a2 2 0 01-2 2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconMap({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="9" y1="3" x2="9" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <line x1="15" y1="6" x2="15" y2="21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconTargetGlyph({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function IconGlobe({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 12h18M12 3c-2.5 3-4 5.7-4 9s1.5 6 4 9M12 3c2.5 3 4 5.7 4 9s-1.5 6-4 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// === Hero bento tiles ==========================================================

const tileShell =
  "flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white/90 p-4 shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90";

function TileLesson({ l }: { l: LandingDict }) {
  return (
    <div className={tileShell}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-brand-blush px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand dark:bg-brand/20 dark:text-brand-soft">
          {l.tileLessonBadge}
        </span>
        <span className="text-[10px] text-zinc-500">{l.tileLessonModule}</span>
      </div>
      <h4 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">{l.tileLessonTitle}</h4>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {l.tileLessonBodyPrefix}
        <span className="rounded bg-brand-blush px-1 text-brand dark:bg-brand/25 dark:text-brand-soft">{l.tileLessonNaOut}</span>
        {l.tileLessonBodyMid}
        <span className="rounded bg-emerald-50 px-1 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300">{l.tileLessonKIn}</span>
        {l.tileLessonBodySuffix}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
          <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-brand to-brand-soft" />
        </div>
        <span className="text-[10px] text-zinc-500">67%</span>
      </div>
    </div>
  );
}

function TileVoice({ l }: { l: LandingDict }) {
  return (
    <div className={tileShell}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">R</span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-900 dark:text-white">Rose</p>
          <p className="flex items-center gap-1 text-[9px] text-zinc-500 dark:text-zinc-400">
            <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-brand" /> {l.tileVoiceListening}
          </p>
        </div>
        <IconMic className="ml-auto h-4 w-4 text-brand dark:text-brand-soft" />
      </div>
      <div className="mt-3 flex h-9 items-center gap-[3px]">
        {[5, 11, 7, 16, 9, 20, 13, 24, 14, 18, 8, 12, 6, 15, 9].map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-gradient-to-t from-brand/40 to-brand"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        &ldquo;{l.tileVoiceQuote}&rdquo;
      </p>
    </div>
  );
}

function TileQuiz({ l }: { l: LandingDict }) {
  return (
    <div className={tileShell}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{l.tileQuizLabel}</p>
      <p className="mt-2 text-[11px] font-medium text-zinc-900 dark:text-white">{l.tileQuizQuestion}</p>
      <div className="mt-2.5 space-y-1.5">
        {[
          { t: "2", ok: false },
          { t: "3", ok: true },
          { t: "4", ok: false },
        ].map((o) => (
          <div
            key={o.t}
            className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${
              o.ok
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300"
                : "border-zinc-200 text-zinc-500 dark:border-white/10 dark:text-zinc-400"
            }`}
          >
            {o.t}
            {o.ok && <span>✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TileFlashcard({ l }: { l: LandingDict }) {
  return (
    <div className={tileShell}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{l.tileFlashcardLabel}</p>
      <p className="mt-2 flex-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {l.tileFlashcardQuestion}
      </p>
      <div className="mt-2 flex gap-1.5">
        {[
          [l.tileFlashAgain, "text-rose-500 dark:text-rose-300"],
          [l.tileFlashHard, "text-amber-500 dark:text-amber-300"],
          [l.tileFlashGood, "text-emerald-600 dark:text-emerald-300"],
        ].map(([label, c]) => (
          <span key={label} className={`flex-1 rounded-md border border-zinc-200 py-1 text-center text-[10px] font-semibold dark:border-white/10 ${c}`}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TileProgress({ l }: { l: LandingDict }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex h-full items-center gap-4 rounded-2xl border border-zinc-200/90 bg-white/90 p-4 shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <svg width="52" height="52" viewBox="0 0 44 44" className="-rotate-90 shrink-0">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-zinc-200 dark:text-zinc-800" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#dc2626"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${0.78 * circ} ${circ}`}
        />
      </svg>
      <div>
        <p className="text-lg font-bold text-zinc-900 dark:text-white">78%</p>
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{l.tileProgressMastery}</p>
        <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-300">{l.tileProgressDelta}</p>
      </div>
    </div>
  );
}

function HeroBento({ l }: { l: LandingDict }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:grid-rows-2">
      <div className="col-span-2 row-span-2 sm:col-span-2">
        <TileLesson l={l} />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <TileVoice l={l} />
      </div>
      <div className="col-span-1">
        <TileQuiz l={l} />
      </div>
      <div className="col-span-1 grid grid-rows-2 gap-3">
        <TileFlashcard l={l} />
        <TileProgress l={l} />
      </div>
    </div>
  );
}

// === Light bento feature tile ==================================================

type Accent = "brand" | "indigo" | "emerald" | "amber";

function BentoTile({
  icon,
  label,
  title,
  body,
  accent = "brand",
  className = "",
  children,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  accent?: Accent;
  className?: string;
  children?: React.ReactNode;
}) {
  const iconBg =
    accent === "indigo"
      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
      : accent === "emerald"
        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
        : accent === "amber"
          ? "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"
          : "bg-brand-blush text-brand dark:bg-[#1e1616]/80 dark:text-brand-soft";
  const labelColor =
    accent === "indigo"
      ? "text-indigo-600 dark:text-indigo-400"
      : accent === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : accent === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "text-brand dark:text-brand-soft";
  return (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-7 shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/95 ${className}`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition group-hover:scale-105 ${iconBg}`}>
        {icon}
      </div>
      <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] ${labelColor}`}>
        {label}
      </p>
      <h3 className="mt-1.5 text-lg font-semibold text-brand-ink dark:text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-brand-muted dark:text-zinc-400">{body}</p>
      {children}
    </div>
  );
}

// === Main export ===============================================================
export async function MarketingLandingContent({
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean;
}) {
  const t = await getT();
  const l = t.landing;
  const year = new Date().getFullYear();
  const ctaPrimary = isAuthenticated ? "/" : "/signup";
  const ctaPrimaryLabel = isAuthenticated ? l.ctaGoToWorkspace : l.ctaGetStarted;

  const subjects = [
    l.subject1, l.subject2, l.subject3, l.subject4,
    l.subject5, l.subject6, l.subject7, l.subject8,
    l.subject9, l.subject10, l.subject11, l.subject12,
  ];

  const steps = [
    ["01", l.step1Title, l.step1Body],
    ["02", l.step2Title, l.step2Body],
    ["03", l.step3Title, l.step3Body],
  ] as const;

  const voiceTags = [l.voiceTag1, l.voiceTag2, l.voiceTag3, l.voiceTag4];
  const publicBullets = [l.publicBullet1, l.publicBullet2, l.publicBullet3];
  const selfStudyBullets = [l.selfStudyBullet1, l.selfStudyBullet2, l.selfStudyBullet3];
  const spotlightItems = [
    [l.spotlightQ1, l.spotlightA1],
    [l.spotlightQ2, l.spotlightA2],
    [l.spotlightQ3, l.spotlightA3],
  ] as const;
  const spotlightAi = [
    { icon: "✓", label: l.spotlightAi1, ok: true },
    { icon: "✓", label: l.spotlightAi2, ok: true },
    { icon: "✓", label: l.spotlightAi3, ok: true },
    { icon: "✗", label: l.spotlightAi4, ok: false },
  ];

  // Headline options (picked: #1):
  //  1. The edge for the class that's breaking you
  //  2. Turn your own course material into a tutor that actually knows it.
  //  3. Understand your hardest classes - built from the material you already have.

  return (
    <main className="flex flex-1 flex-col bg-app-gradient">

      {/* === Hero === */}
      <section className="relative overflow-hidden">
        {/* soft glow blobs */}
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[700px] -translate-x-1/2 animate-aura-drift rounded-full bg-brand/10 blur-[120px] dark:bg-brand/8" />
        <div aria-hidden className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-indigo-400/10 blur-[80px] dark:bg-indigo-400/8" />

        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-20 sm:px-6 sm:pt-28">
          <div className="mx-auto max-w-4xl text-center">
            <p className="animate-hero-rise inline-flex items-center gap-2 rounded-full border border-brand-border bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-brand shadow-sm backdrop-blur dark:border-brand-border/40 dark:bg-zinc-900/80 dark:text-brand-soft">
              <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-brand" />
              {l.heroEyebrow}
            </p>

            <h1 className="mx-auto mt-7 max-w-4xl text-balance text-[2.75rem] font-semibold leading-[1.02] tracking-tight text-brand-ink sm:text-6xl md:text-7xl dark:text-white">
              <ScrollTypewriter
                mode="chars"
                charStepMs={30}
                segments={[
                  { text: l.heroPrefix },
                  { text: l.heroAccent, className: "text-brand dark:text-brand-soft" },
                ]}
              />
            </h1>

            <p
              style={{ animationDelay: "0.16s" }}
              className="animate-hero-rise mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-brand-muted sm:text-xl dark:text-zinc-400"
            >
              {l.heroSub}
            </p>

            <div
              style={{ animationDelay: "0.24s" }}
              className="animate-hero-rise mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <Link
                href={ctaPrimary}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:hover:bg-brand-soft"
              >
                {ctaPrimaryLabel}
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white/80 px-8 py-3.5 text-sm font-semibold text-zinc-800 backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {l.browseCourses}
              </Link>
            </div>

            <p
              style={{ animationDelay: "0.3s" }}
              className="animate-hero-rise mt-6 text-sm text-brand-muted dark:text-zinc-500"
            >
              {l.socialProofPrefix}
              <span className="font-semibold text-brand-ink dark:text-zinc-200">
                {l.socialProofCount}
              </span>
              {l.socialProofSuffix}
            </p>
          </div>

          {/* product bento */}
          <div
            style={{ animationDelay: "0.36s" }}
            className="animate-hero-rise relative mx-auto mt-14 max-w-4xl"
          >
            <HeroBento l={l} />
          </div>
        </div>
      </section>

      {/* === Subject marquee === */}
      <section className="border-y border-zinc-200/70 bg-white/60 py-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="flex items-center gap-6 overflow-hidden">
          <span className="shrink-0 pl-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-muted dark:text-zinc-500 sm:pl-6">
            {l.worksForAnyClass}
          </span>
          <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            <div className="animate-marquee flex w-max items-center gap-3">
              {[...subjects, ...subjects].map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="whitespace-nowrap rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* === How it works: editorial big numbers === */}
      <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand dark:text-brand-soft">
            {l.howEyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-ink dark:text-zinc-50 sm:text-5xl">
            <ScrollTypewriter text={l.howTitle} />
          </h2>
        </div>

        <div className="mt-16 space-y-px">
          {steps.map(([n, title, body], i) => (
            <Reveal key={n} delay={i * 130}>
              <div className="group grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-2 border-t border-zinc-200/80 py-8 transition dark:border-white/10 sm:grid-cols-[7rem_1fr] sm:gap-x-10">
                <span className="text-5xl font-bold tabular-nums leading-none text-brand-soft sm:text-7xl dark:text-brand-ink">
                  {n}
                </span>
                <div className="pt-1 sm:pt-3">
                  <h3 className="text-xl font-semibold text-brand-ink dark:text-zinc-100 sm:text-2xl">{title}</h3>
                  <p className="mt-2 max-w-2xl leading-relaxed text-brand-muted dark:text-zinc-400">{body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* === Bento feature showcase === */}
      <section className="border-t border-zinc-200/70 bg-white/50 py-24 dark:border-white/[0.06] dark:bg-white/[0.02] sm:py-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand dark:text-brand-soft">
              {l.featuresEyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-ink dark:text-zinc-50 sm:text-5xl">
              <ScrollTypewriter text={l.featuresTitle} />
            </h2>
          </div>

          <div className="mt-16 grid auto-rows-[1fr] gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Reveal className="h-full sm:col-span-2 lg:row-span-2">
              <BentoTile
                className="lg:row-span-2"
                icon={<IconMic className="h-6 w-6" />}
                label={l.voiceLabel}
                title={l.voiceTitle}
                body={l.voiceBody}
              >
                <div className="mt-5 flex flex-wrap gap-2">
                  {voiceTags.map((tag) => (
                    <span key={tag} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-2 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">R</span>
                  <div className="flex h-7 flex-1 items-center gap-[3px]">
                    {[6, 12, 8, 18, 10, 22, 13, 26, 15, 19, 9, 14, 7, 16].map((h, i) => (
                      <span key={i} className="w-[3px] rounded-full bg-gradient-to-t from-brand/40 to-brand" style={{ height: `${h}px` }} />
                    ))}
                  </div>
                  <span className="flex h-2 w-2 animate-soft-pulse rounded-full bg-brand" />
                </div>
              </BentoTile>
            </Reveal>

            <Reveal delay={110} className="h-full">
              <BentoTile
                icon={<IconBolt className="h-6 w-6" />}
                label={l.lessonsLabel}
                title={l.lessonsTitle}
                body={l.lessonsBody}
              />
            </Reveal>

            <Reveal delay={220} className="h-full">
              <BentoTile
                accent="emerald"
                icon={<IconCheckCircle className="h-6 w-6" />}
                label={l.quizLabel}
                title={l.quizTitle}
                body={l.quizBody}
              />
            </Reveal>

            <Reveal delay={330} className="h-full">
              <BentoTile
                accent="amber"
                icon={<IconCards className="h-6 w-6" />}
                label={l.srsLabel}
                title={l.srsTitle}
                body={l.srsBody}
              />
            </Reveal>

            <Reveal delay={440} className="h-full">
              <BentoTile
                accent="indigo"
                icon={<IconMap className="h-6 w-6" />}
                label={l.navLabel}
                title={l.navTitle}
                body={l.navBody}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* === Two modes === */}
      <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand dark:text-brand-soft">
            {l.modesEyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-ink dark:text-zinc-50 sm:text-5xl">
            <ScrollTypewriter text={l.modesTitle} />
          </h2>
        </div>
        <div className="mt-16 grid gap-5 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-3xl border border-zinc-200/90 bg-white/95 p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-blush text-brand dark:bg-[#1e1616]/80 dark:text-brand-soft">
                <IconGlobe />
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand dark:text-brand-soft">{l.publicLabel}</p>
              <h3 className="mt-1.5 text-lg font-semibold text-brand-ink dark:text-zinc-100">{l.publicTitle}</h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted dark:text-zinc-400">
                {l.publicBody}
              </p>
              <ul className="mt-5 space-y-2">
                {publicBullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-emerald-500">✓</span> {b}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={150} className="h-full">
            <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/60 to-white/95 p-8 shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-zinc-950/95">
              <span className="absolute right-5 top-5 rounded-full bg-indigo-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-indigo-500">{l.selfStudyNew}</span>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                <IconTargetGlyph />
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">{l.selfStudyLabel}</p>
              <h3 className="mt-1.5 text-lg font-semibold text-brand-ink dark:text-zinc-100">{l.selfStudyTitle}</h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted dark:text-zinc-400">
                {l.selfStudyBody}
              </p>
              <ul className="mt-5 space-y-2">
                {selfStudyBullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-indigo-500">✓</span> {b}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* === Self Study spotlight === */}
      <section className="border-y border-zinc-200/70 bg-white/50 py-24 dark:border-zinc-800/80 dark:bg-zinc-950/40 sm:py-32">
        <Reveal className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="overflow-hidden rounded-[2rem] border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-white shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950">
            <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-2 lg:items-center lg:gap-16">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">{l.spotlightEyebrow}</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-brand-ink dark:text-zinc-50 sm:text-4xl">
                  {l.spotlightTitlePrefix}
                  <span className="text-indigo-600 dark:text-indigo-400">{l.spotlightTitleAccent}</span>
                  {l.spotlightTitleSuffix}
                </h2>
                <p className="mt-4 leading-relaxed text-brand-muted dark:text-zinc-400">
                  {tf(l.spotlightBody, { app: APP_NAME })}
                </p>
                <ul className="mt-6 space-y-4 text-sm">
                  {spotlightItems.map(([k, v]) => (
                    <li key={k} className="flex gap-3">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                      <span>
                        <span className="font-medium text-brand-ink dark:text-zinc-200">{k}</span>{" "}
                        <span className="text-brand-muted dark:text-zinc-400">{v}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={ctaPrimary}
                  className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-7 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  {l.spotlightCta}
                  <span aria-hidden>→</span>
                </Link>
              </div>
              <div className="rounded-2xl border border-indigo-200/70 bg-white p-5 shadow-sm dark:border-indigo-900/40 dark:bg-zinc-900">
                <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{l.spotlightSetupLabel}</p>
                <p className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm italic leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  &ldquo;{l.spotlightSetupExample}&rdquo;
                </p>
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{l.spotlightAiLabel}</p>
                  {spotlightAi.map(({ icon, label, ok }) => (
                    <div key={label} className={`flex items-center gap-2 text-xs ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                      <span className="text-sm font-bold">{icon}</span> {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* === Closing CTA === */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-0 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-brand-border bg-gradient-to-br from-brand-blush via-white to-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-950 sm:px-12 sm:py-20">
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand/10 blur-[90px] dark:bg-brand/15" />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight text-brand-ink sm:text-4xl dark:text-white">
                {l.closingTitlePrefix}
                <span className="text-brand dark:text-brand-soft">{l.closingTitleAccent}</span>
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-brand-muted dark:text-zinc-400">
                {l.closingBody}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={ctaPrimary}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:hover:bg-brand-soft"
                >
                  {ctaPrimaryLabel}
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/explore"
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white/80 px-8 py-3.5 text-sm font-semibold text-zinc-800 backdrop-blur transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  {l.browseCourses}
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* === Footer === */}
      <footer className="border-t border-zinc-200/80 bg-white/40 px-4 py-12 dark:border-white/[0.06] dark:bg-white/[0.02] sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
          <div className="flex w-full flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-9 w-9 sm:h-10 sm:w-10" />
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {`© ${year} ${APP_NAME}`}
              </p>
            </div>
            <nav
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:justify-end"
              aria-label={l.footerSiteNav}
            >
              <Link href="/explore" className="hover:text-brand dark:hover:text-brand-soft">{t.nav.explore}</Link>
              <Link href="/forum" className="hover:text-brand dark:hover:text-brand-soft">{t.nav.forum}</Link>
              {isAuthenticated ? (
                <>
                  <Link href="/" className="hover:text-brand dark:hover:text-brand-soft">{l.footerWorkspace}</Link>
                  <Link href="/dashboard/profile" className="hover:text-brand dark:hover:text-brand-soft">{t.nav.profile}</Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:text-brand dark:hover:text-brand-soft">{t.nav.login}</Link>
                  <Link href="/signup" className="hover:text-brand dark:hover:text-brand-soft">{t.nav.signup}</Link>
                </>
              )}
            </nav>
          </div>
          <div className="w-full max-w-xl border-t border-zinc-200/70 pt-8 dark:border-white/[0.06]">
            <LegalFooterLinks className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-500" />
          </div>
        </div>
      </footer>
    </main>
  );
}
