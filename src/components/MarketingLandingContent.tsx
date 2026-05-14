import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { APP_NAME } from "@/lib/brand";

// ─── SVG icons ────────────────────────────────────────────────────────────────

function IconUpload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

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

function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
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

function IconChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="14" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="16" y="4" width="4" height="17" rx="1" stroke="currentColor" strokeWidth="1.5" />
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

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 12h18M12 3c-2.5 3-4 5.7-4 9s1.5 6 4 9M12 3c2.5 3 4 5.7 4 9s-1.5 6-4 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({
  icon,
  label,
  title,
  body,
  accent = "brand",
  wide = false,
  tall = false,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  accent?: "brand" | "indigo" | "emerald" | "amber";
  wide?: boolean;
  tall?: boolean;
  extra?: React.ReactNode;
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
      className={`rounded-3xl border border-zinc-200/90 bg-white/95 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95 sm:p-7 ${wide ? "sm:col-span-2" : ""} ${tall ? "lg:row-span-2" : ""}`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
      <p className={`mt-4 text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}>
        {label}
      </p>
      <h3 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
      {extra}
    </div>
  );
}

// ─── Voice tutor mock UI ───────────────────────────────────────────────────────
function VoiceTutorPreview() {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white text-sm font-bold">R</div>
        <div>
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">Ask Rose</p>
          <p className="text-[10px] text-zinc-500">Voice tutor · always on</p>
        </div>
        <div className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
          <div className="h-2.5 w-2.5 rounded-full bg-brand animate-pulse" />
        </div>
      </div>
      <div className="space-y-2.5 px-4 py-3">
        {[
          { role: "user",      text: "can you explain the Krebs cycle quickly?" },
          { role: "assistant", text: "Okay so, think of it as a loop that runs twice per glucose molecule…" },
          { role: "user",      text: "take me to the module about ATP synthesis" },
          { role: "assistant", text: "On it — navigating you there now." },
        ].map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed ${
                m.role === "user"
                  ? "bg-brand text-white"
                  : "bg-white text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {m.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Self study mock UI ───────────────────────────────────────────────────────
function SelfStudyPreview() {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-indigo-200/70 bg-indigo-50/40 dark:border-indigo-900/40 dark:bg-indigo-950/20">
      <div className="border-b border-indigo-200/70 px-4 py-3 dark:border-indigo-900/40">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Your study goal</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 italic">
          "I have an exam in 2 days and I'm really struggling with photosynthesis…"
        </p>
      </div>
      <div className="px-4 py-3">
        <p className="text-[10px] text-zinc-500 dark:text-zinc-500">AI adjusted for you</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["📌 Exam-focused language", "🔍 Expanded photosynthesis", "⚡ Quick retention structure"].map(t => (
            <span key={t} className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Progress ring (pure CSS) ─────────────────────────────────────────────────
function MiniRing({ pct, color, label }: { pct: number; color: string; label: string }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-zinc-200 dark:text-zinc-800" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{pct}%</p>
    </div>
  );
}

// ─── Step badge ────────────────────────────────────────────────────────────────
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="relative rounded-2xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
      <span className="font-mono text-3xl font-bold tabular-nums text-brand-soft dark:text-brand-ink">{n}</span>
      <h3 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
    </li>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
export function MarketingLandingContent({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const year = new Date().getFullYear();
  const ctaPrimary = isAuthenticated ? "/" : "/signup";
  const ctaPrimaryLabel = isAuthenticated ? "Go to workspace" : "Get started free";

  return (
    <main className="flex flex-1 flex-col bg-app-gradient">

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Glow blobs */}
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-brand/10 blur-[120px] dark:bg-brand/8" />
        <div aria-hidden className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-indigo-400/10 blur-[80px] dark:bg-indigo-400/8" />

        <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center rounded-full border border-brand-border bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-brand shadow-sm dark:border-brand-border/40 dark:bg-zinc-900/80 dark:text-brand-soft">
              AI study tutor · voice + text · built from your PDFs
            </p>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-brand-ink sm:text-6xl sm:leading-[1.06] dark:text-white">
              Your AI study partner.<br />
              <span className="text-brand dark:text-brand-soft">Built from your material.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-brand-muted dark:text-zinc-400">
              Upload a PDF and {APP_NAME} turns it into lessons, quizzes, and a voice tutor that knows your notes inside out — personalised to your exact study goal.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={ctaPrimary}
                className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
              >
                {ctaPrimaryLabel}
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white/80 px-8 py-3.5 text-sm font-semibold text-zinc-800 backdrop-blur hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                Browse courses
              </Link>
            </div>

            {/* Feature pills */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {[
                "🎤 Voice tutor",
                "🎯 Self Study Mode",
                "📚 AI-generated lessons",
                "🧠 Per-module quizzes",
                "🃏 Spaced repetition cards",
                "📊 Progress tracking",
                "🧭 Navigation commands",
                "🌐 Public courses",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Two modes ──────────────────────────────────────────────────────────── */}
      <section className="border-y border-zinc-200/70 bg-white/50 py-16 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Two ways to study
            </h2>
            <p className="mt-3 text-zinc-500 dark:text-zinc-400">
              Both turn your PDFs into a full course — the difference is who it&apos;s for.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {/* Public course */}
            <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-blush text-brand text-2xl dark:bg-[#1e1616]/80">
                🌐
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Public course
              </p>
              <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Share with other students
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Structure your material into sections, upload your lecture PDFs, and publish. Others can discover and enroll right from the Explore page.
              </p>
              <ul className="mt-4 space-y-1.5">
                {["Visible on Explore", "Multi-section organisation", "Learner progress tracking"].map(b => (
                  <li key={b} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-emerald-500">✓</span> {b}
                  </li>
                ))}
              </ul>
            </div>

            {/* Self study mode */}
            <div className="rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/60 to-white/95 p-7 shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-zinc-950/95">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-2xl dark:bg-indigo-950/60">
                🎯
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Self Study Mode — new
              </p>
              <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Calibrated to your exact goal
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Describe your situation in plain text — &ldquo;exam in 2 days, weak on photosynthesis&rdquo; — and the AI builds the whole course around that. Completely private.
              </p>
              <ul className="mt-4 space-y-1.5">
                {["AI depth calibrated to your goal", "Voice tutor knows your background", "Private — never on Explore"].map(b => (
                  <li key={b} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-indigo-500">✓</span> {b}
                  </li>
                ))}
              </ul>
              <SelfStudyPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Upload. Choose. Study.
          </h2>
          <p className="mt-3 text-zinc-500 dark:text-zinc-400">
            Three steps from PDF to a full personalised course with a voice tutor on call.
          </p>
        </div>
        <ol className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-3">
          <Step
            n="01"
            title="Upload your lecture PDFs"
            body="Drop one or many PDFs — lecture slides, notes, textbook chapters. No formatting needed."
          />
          <Step
            n="02"
            title="Choose your mode"
            body="Create a public course for others, or enter Self Study Mode and describe your exact goal. The AI calibrates everything from there."
          />
          <Step
            n="03"
            title="Learn with Rose"
            body="Read AI-generated lessons, take per-module quizzes, and talk to Rose — your voice tutor who knows your notes and your goal."
          />
        </ol>
      </section>

      {/* ── Feature grid ──────────────────────────────────────────────────────── */}
      <section className="border-t border-zinc-200/70 bg-white/30 py-20 dark:border-zinc-800 dark:bg-zinc-950/20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Everything in one place
            </h2>
            <p className="mt-3 text-zinc-500 dark:text-zinc-400">
              Every tool you need to go from &ldquo;just uploaded&rdquo; to genuinely understanding the material.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

            {/* Voice tutor — wide */}
            <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95 sm:col-span-2 sm:p-7">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blush text-brand dark:bg-[#1e1616]/80 dark:text-brand-soft">
                <IconMic className="h-6 w-6" />
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">Voice Tutor</p>
              <h3 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Talk to Rose — your AI tutor who knows your notes
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Ask questions out loud, get spoken answers in seconds. Rose only uses your uploaded material — no hallucinated facts. Say &ldquo;take me to the module about ATP synthesis&rdquo; and she navigates you there instantly.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Live voice conversation", "Navigation commands", "Knows your study goal", "Korean + multilingual"].map(t => (
                  <span key={t} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t}</span>
                ))}
              </div>
              <VoiceTutorPreview />
            </div>

            <FeatureCard
              icon={<IconBolt className="h-6 w-6" />}
              label="AI Lessons"
              title="Lessons written from your exact slides"
              body="Each module gets structured lessons with key terms, real-world examples, and explanations — grounded only in what you uploaded."
              accent="brand"
            />

            <FeatureCard
              icon={<IconCheckCircle className="h-6 w-6" />}
              label="Per-module quizzes"
              title="Test yourself after every module"
              body="Mixed multiple-choice and written questions after each module. Wrong answers are surfaced for review so nothing slips through."
              accent="emerald"
            />

            <FeatureCard
              icon={<IconCards className="h-6 w-6" />}
              label="Spaced repetition"
              title="Anki-like cards from your highlights"
              body="Highlight anything while reading and it becomes a personal flashcard. The scheduler spaces reviews over days — no importing decks by hand."
              accent="amber"
            />

            <FeatureCard
              icon={<IconChart className="h-6 w-6" />}
              label="Progress tracking"
              title="Rings, mosaics and a study calendar"
              body="Module completion rings, quiz accuracy, a module mosaic, and a calendar heatmap — so 'how am I doing?' has a real answer at a glance."
              accent="brand"
              extra={
                <div className="mt-5 flex items-end gap-5">
                  <MiniRing pct={72} color="#e63232" label="Modules" />
                  <MiniRing pct={84} color="#22c55e" label="Quiz" />
                  <div className="mb-1 grid grid-cols-7 gap-0.5">
                    {Array.from({ length: 28 }, (_, i) => (
                      <div
                        key={i}
                        className="h-3 w-3 rounded-[2px]"
                        style={{ background: i % 3 === 0 ? "#e63232" : i % 5 === 0 ? "#fca5a5" : "#f4f4f5" }}
                      />
                    ))}
                  </div>
                </div>
              }
            />

            <FeatureCard
              icon={<IconMap className="h-6 w-6" />}
              label="Smart navigation"
              title={'Say "take me to carbs" — and Rose does'}
              body='Both the chat and voice tutor understand navigation intent. Ask to jump to any module, topic, or section and the app navigates you there automatically.'
              accent="indigo"
            />

            <FeatureCard
              icon={<IconGlobe className="h-6 w-6" />}
              label="Explore"
              title="Browse what others are studying"
              body="Public courses live on the Explore page — browse outlines, enroll, and study alongside other students using the same AI tools."
              accent="brand"
            />

          </div>
        </div>
      </section>

      {/* ── Self Study Mode spotlight ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="overflow-hidden rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-white dark:border-indigo-900/40 dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950">
          <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Self Study Mode
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
                AI that knows your situation, not just your subject
              </h2>
              <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">
                Tell {APP_NAME} exactly where you&apos;re at — exam in two days, already know the basics, struggling with one topic, want a deep dive — and every lesson, quiz, and voice conversation is calibrated to match.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  ["🗓️ Exam deadline?", "Content prioritises testable concepts and quick retention."],
                  ["📚 Already know the basics?", "Introductions are skipped. Nuance and depth get more space."],
                  ["❓ Struggling with one topic?", "That section expands significantly compared to everything else."],
                  ["🤷 No specific context?", "Balanced, well-rounded course — nothing assumed."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-3">
                    <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-300">{k}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{v}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={ctaPrimary}
                className="mt-8 inline-flex items-center justify-center rounded-full bg-indigo-600 px-7 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                Try Self Study Mode →
              </Link>
            </div>
            <div className="rounded-2xl border border-indigo-200/70 bg-white p-5 shadow-sm dark:border-indigo-900/40 dark:bg-zinc-900">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Setup prompt</p>
              <p className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm italic leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                &ldquo;I have a biochemistry final in 3 days. I&apos;m okay with glycolysis but I keep blanking on the Krebs cycle and oxidative phosphorylation. Skip anything about lipids — we weren&apos;t tested on that.&rdquo;
              </p>
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">What the AI does</p>
                {[
                  { icon: "✓", label: "Krebs cycle — expanded with extra examples" },
                  { icon: "✓", label: "Oxidative phosphorylation — exam-focused language" },
                  { icon: "✓", label: "Glycolysis — brief recap, no intro padding" },
                  { icon: "✗", label: "Lipids section — skipped entirely" },
                ].map(({ icon, label }) => (
                  <div key={label} className={`flex items-center gap-2 text-xs ${icon === "✓" ? "text-emerald-600 dark:text-emerald-400" : "text-red-400 dark:text-red-500"}`}>
                    <span className="text-sm font-bold">{icon}</span> {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Explore CTA ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-8 pt-0 sm:px-6">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand-hover to-brand-hover px-8 py-12 text-center shadow-xl shadow-red-900/20 sm:px-12 sm:py-16">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">
            Ready to actually understand your material?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-white/90">
            Upload a PDF, choose your mode, and Rose builds your course in minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={ctaPrimary}
              className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-brand shadow-lg transition hover:bg-brand-blush"
            >
              {ctaPrimaryLabel}
            </Link>
            <Link
              href="/explore"
              className="inline-flex items-center justify-center rounded-full border border-white/40 bg-white/10 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
            >
              Open Explore
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="mt-16 border-t border-zinc-200/80 bg-white/40 px-4 py-12 dark:border-zinc-800 dark:bg-zinc-950/50 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
          <div className="flex w-full flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-9 w-9 sm:h-10 sm:w-10" />
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                © {year} {APP_NAME}
              </p>
            </div>
            <nav
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:justify-end"
              aria-label="Site"
            >
              <Link href="/explore" className="hover:text-brand dark:hover:text-brand-soft">Explore</Link>
              {isAuthenticated ? (
                <>
                  <Link href="/" className="hover:text-brand dark:hover:text-brand-soft">Workspace</Link>
                  <Link href="/dashboard/profile" className="hover:text-brand dark:hover:text-brand-soft">Profile</Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:text-brand dark:hover:text-brand-soft">Log in</Link>
                  <Link href="/signup" className="hover:text-brand dark:hover:text-brand-soft">Sign up</Link>
                </>
              )}
            </nav>
          </div>
          <div className="w-full max-w-xl border-t border-zinc-200/70 pt-8 dark:border-zinc-800">
            <LegalFooterLinks className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-500" />
          </div>
        </div>
      </footer>
    </main>
  );
}
