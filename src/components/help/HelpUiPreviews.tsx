"use client";

import { useT } from "@/lib/i18n/LocaleProvider";
import { HelpRichText } from "@/components/help/HelpRichText";

/** Mini UI replicas so the help page shows what users actually see in the app. */

export function HelpPreviewFrame({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  const t = useT().help;
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-md ring-1 ring-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950 dark:ring-zinc-700/40">
      <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {t.previews.whatYoullSee}
        </p>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
      </div>
      <div className="bg-app-gradient p-4 sm:p-5">{children}</div>
      {caption ? (
        <figcaption className="border-t border-zinc-100 px-4 py-3 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function WorkspacePreview() {
  const t = useT().help.previews.workspace;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-zinc-200/90 bg-white/95 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {t.label}
        </p>
        <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t.heading}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white">
            {t.createCourse}
          </span>
          <span className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">
            {t.startTutor}
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/40">
        <span className="font-semibold text-emerald-900 dark:text-emerald-200">
          {t.cardsDue}
        </span>
        <span className="ml-2 text-emerald-800/80 dark:text-emerald-300/80">
          {t.reviewLink}
        </span>
      </div>
    </div>
  );
}

export function CourseCardPreview({ listed }: { listed: boolean }) {
  const t = useT().help.previews.courseCard;
  return (
    <div className="relative max-w-xs rounded-2xl border border-zinc-200/90 bg-white pt-6 shadow-md dark:border-zinc-800 dark:bg-zinc-950">
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-brand via-red-500 to-brand-soft" />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Bio 1A
          </span>
          <span
            className={
              listed
                ? "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200"
                : "rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
            }
          >
            {listed ? t.onExplore : t.notOnExplore}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          General Biology
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-brand/25 bg-brand-blush/70 px-3 py-1.5 text-xs font-semibold text-brand">
            {t.openCourse}
          </span>
          <span
            className={
              listed
                ? "rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600"
                : "rounded-full border border-emerald-400/60 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            }
          >
            {listed ? t.makePrivate : t.makePublic}
          </span>
        </div>
      </div>
    </div>
  );
}

export function VisibilitySwitchPreview({ on }: { on: boolean }) {
  const t = useT().help.previews.visibility;
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t.heading}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {on ? t.listedOnExplore : t.privateOnly}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={
              on
                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800"
                : "rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600"
            }
          >
            {on ? t.public : t.private}
          </span>
          <span
            className={[
              "relative inline-flex h-8 w-[3.25rem] rounded-full",
              on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600",
            ].join(" ")}
            aria-hidden
          >
            <span
              className={[
                "absolute top-1 inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform",
                on ? "left-[1.35rem]" : "left-0.5",
              ].join(" ")}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

export function UploadLectureStacksPreview() {
  const t = useT().help.previews.upload;
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.summary}</p>
      <div className="rounded-xl border border-zinc-300 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          1 · {t.lectureLabel.replace("{n}", "1")}
          <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
            {t.lectureCombined}
          </span>
        </p>
        <div className="mt-2 space-y-1.5">
          {["notes-week3.txt", "diagram.png"].map((f) => (
            <div
              key={f}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              <span>📄</span>
              <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                {f}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          2 · {t.lectureLabel.replace("{n}", "2")}
        </p>
        <div className="mt-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950">
          📄 midterm-review.pdf
        </div>
      </div>
    </div>
  );
}

export function ModeTogglePreview() {
  const t = useT();
  return (
    <div className="rounded-2xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-900 dark:bg-zinc-900/30">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {t.help.previews.modeToggle.label}
      </p>
      <div className="mt-2 inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
        <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white">
          {t.tutor.mentoredLearning}
        </span>
        <span className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          {t.tutor.freeExploration}
        </span>
      </div>
    </div>
  );
}

export function VoiceModesPreview() {
  const t = useT().help.previews.voiceModes;
  return (
    <div className="flex flex-wrap gap-2">
      <div className="rounded-xl border border-brand/30 bg-brand-blush/40 px-3 py-2 dark:bg-brand-blush/10">
        <p className="text-[10px] font-bold uppercase text-brand">{t.holdM}</p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {t.holdMHint}
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
        <p className="text-[10px] font-bold uppercase text-zinc-500">{t.live}</p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {t.liveHint}
        </p>
      </div>
    </div>
  );
}

export function PracticeRoomPreview() {
  const t = useT().help.previews.practiceRoom;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="inline-flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold shadow-sm dark:bg-zinc-800">
          {t.moduleQuiz}
        </span>
        <span className="rounded-full px-3 py-1 text-xs font-semibold text-zinc-500">
          {t.focusQuiz}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
        <HelpRichText text={t.hint} />
      </p>
    </div>
  );
}

export function SrsRatingPreview() {
  const t = useT().review;
  const labels = [t.again, t.hard, t.good, t.easy] as const;
  const keys = ["1", "2", "3", "4"] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label, i) => (
        <span
          key={label}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900"
        >
          <kbd className="rounded bg-zinc-100 px-1 font-mono text-[10px] dark:bg-zinc-800">
            {keys[i]}
          </kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

export function TutorModesPreview() {
  const modes = useT().help.previews.tutorModes;
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((m) => (
        <span
          key={m}
          className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-950"
        >
          {m}
        </span>
      ))}
    </div>
  );
}

export function NavPreview() {
  const t = useT();
  const items = [
    t.nav.home,
    t.help.previews.nav.tutor,
    t.nav.explore,
    t.help.previews.nav.reviewBadge,
    t.nav.profile,
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
      {items.map((item) => (
        <span
          key={item}
          className={
            item === t.help.previews.nav.reviewBadge
              ? "text-brand dark:text-brand-soft"
              : undefined
          }
        >
          {item}
        </span>
      ))}
    </div>
  );
}
