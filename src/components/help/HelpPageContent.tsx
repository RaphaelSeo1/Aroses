"use client";

import { useEffect, useState } from "react";
import { getHelpVideos } from "@/lib/help-videos";
import { HonestFaqSection } from "@/components/help/HonestFaqSection";
import { HelpRichText } from "@/components/help/HelpRichText";
import {
  CourseCardPreview,
  HelpPreviewFrame,
  ModeTogglePreview,
  NavPreview,
  PracticeRoomPreview,
  SrsRatingPreview,
  TutorModesPreview,
  UploadLectureStacksPreview,
  VisibilitySwitchPreview,
  VoiceModesPreview,
  WorkspacePreview,
} from "@/components/help/HelpUiPreviews";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";

function RichLi({ text }: { text: string }) {
  return (
    <li>
      <HelpRichText text={text} />
    </li>
  );
}

function VideoGrid() {
  const locale = useLocale();
  const t = useT().help;
  const videos = getHelpVideos(locale);

  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2">
      {videos.map((v) => (
        <div
          key={v.id}
          className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {v.embedUrl ? (
            <div className="aspect-video w-full bg-zinc-900">
              <iframe
                src={v.embedUrl}
                title={v.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-100 to-zinc-200/80 px-6 text-center dark:from-zinc-900 dark:to-zinc-950">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-md dark:bg-zinc-800">
                <svg
                  className="h-6 w-6 text-brand"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {t.videoComingSoon}
              </p>
              {v.durationLabel ? (
                <p className="text-[11px] text-zinc-400">{v.durationLabel}</p>
              ) : null}
            </div>
          )}
          <div className="p-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {v.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {v.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HelpPageContent() {
  const t = useT().help;
  const sections = t.sections;
  const [activeId, setActiveId] = useState<string>("quick-start");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveId(e.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 lg:gap-12">
      <nav
        aria-label={t.navAriaLabel}
        className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-52 shrink-0 overflow-y-auto lg:block"
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          {t.onThisPage}
        </p>
        <ul className="mt-3 space-y-1 border-l border-zinc-200 dark:border-zinc-800">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={[
                  "-ml-px block border-l-2 py-1.5 pl-3 text-sm transition",
                  activeId === s.id
                    ? "border-brand font-semibold text-brand dark:border-brand-soft dark:text-brand-soft"
                    : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                ].join(" ")}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t.intro}
        </p>

        <section id="quick-start" className="mt-12 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.quickStart.title}
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {t.quickStart.steps.map((step) => (
              <RichLi key={step} text={step} />
            ))}
          </ol>
          <p className="mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {t.quickStart.loop}
          </p>

          <HelpPreviewFrame
            title={t.quickStart.previewTitle}
            caption={t.quickStart.previewCaption}
          >
            <WorkspacePreview />
          </HelpPreviewFrame>
        </section>

        <section id="videos" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.videos.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t.videos.intro}
          </p>
          <div className="mt-6">
            <VideoGrid />
          </div>
        </section>

        <section id="getting-started" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.gettingStarted.title}
          </h2>

          <h3 className="mt-6 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t.gettingStarted.signup.heading}
          </h3>
          <p className="mt-2 text-sm leading-relaxed">
            {t.gettingStarted.signup.intro}
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.gettingStarted.signup.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t.gettingStarted.navigation.heading}
          </h3>
          <p className="mt-2 text-sm leading-relaxed">
            {t.gettingStarted.navigation.intro}
          </p>
          <HelpPreviewFrame
            title={t.gettingStarted.navigation.previewTitle}
            caption={t.gettingStarted.navigation.previewCaption}
          >
            <NavPreview />
          </HelpPreviewFrame>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.gettingStarted.navigation.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="building" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.building.title}
          </h2>

          <h3 className="mt-6 text-base font-semibold">{t.building.createHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.building.createItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold">{t.building.uploadHeading}</h3>
          <p className="mt-2 text-sm leading-relaxed">
            <HelpRichText text={t.building.uploadBody} />
          </p>

          <HelpPreviewFrame
            title={t.building.uploadPreviewTitle}
            caption={t.building.uploadPreviewCaption}
          >
            <UploadLectureStacksPreview />
          </HelpPreviewFrame>

          <h3 className="mt-6 text-base font-semibold">{t.building.buildFlowHeading}</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            {t.building.buildFlowSteps.map((step) => (
              <RichLi key={step} text={step} />
            ))}
          </ol>

          <h3 className="mt-6 text-base font-semibold">{t.building.managingHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.building.managingItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold">{t.building.visibilityHeading}</h3>
          <p className="mt-2 text-sm leading-relaxed">
            <HelpRichText text={t.building.visibilityBody} />
          </p>
          <HelpPreviewFrame
            title={t.building.visibilityPreviewTitle}
            caption={t.building.visibilityPreviewCaption}
          >
            <VisibilitySwitchPreview on={false} />
          </HelpPreviewFrame>
          <HelpPreviewFrame title={t.building.courseCardPreviewTitle}>
            <CourseCardPreview listed={false} />
          </HelpPreviewFrame>
        </section>

        <section id="mentored" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.mentored.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">{t.mentored.intro}</p>

          <HelpPreviewFrame title={t.mentored.modePickerPreviewTitle}>
            <ModeTogglePreview />
          </HelpPreviewFrame>

          <h3 className="mt-6 text-base font-semibold">{t.mentored.onboardingHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.mentored.onboardingItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold">{t.mentored.duringHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.mentored.duringItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <HelpPreviewFrame
            title={t.mentored.voicePreviewTitle}
            caption={t.mentored.voicePreviewCaption}
          >
            <VoiceModesPreview />
          </HelpPreviewFrame>
        </section>

        <section id="free-explore" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.freeExplore.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">{t.freeExplore.intro}</p>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            {t.freeExplore.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="quizzes" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.quizzes.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            <HelpRichText text={t.quizzes.intro} />
          </p>

          <HelpPreviewFrame title={t.quizzes.previewTitle}>
            <PracticeRoomPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            {t.quizzes.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="review" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.review.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            <HelpRichText text={t.review.intro} />
          </p>

          <HelpPreviewFrame
            title={t.review.previewTitle}
            caption={t.review.previewCaption}
          >
            <SrsRatingPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            {t.review.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="tutor" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.tutor.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            <HelpRichText text={t.tutor.intro} />
          </p>

          <HelpPreviewFrame title={t.tutor.previewTitle}>
            <TutorModesPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            {t.tutor.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold">{t.tutor.inactivityHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.tutor.inactivityItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>

          <h3 className="mt-6 text-base font-semibold">{t.tutor.afterHeading}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {t.tutor.afterItems.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="explore" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.explore.title}
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
            {t.explore.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <section id="sharing" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.sharing.title}
          </h2>
          <div className="not-prose mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-semibold text-zinc-900 dark:text-zinc-100">
                    {t.sharing.tableWhat}
                  </th>
                  <th className="py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    {t.sharing.tableOthers}
                  </th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                {t.sharing.rows.map((row) => (
                  <tr
                    key={row.what}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/80"
                  >
                    <td className="py-3 pr-4">{row.what}</td>
                    <td className="py-3">{row.others}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="progress" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.progress.title}
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
            {t.progress.items.map((item) => (
              <RichLi key={item} text={item} />
            ))}
          </ul>
        </section>

        <HonestFaqSection />
      </article>
    </div>
  );
}
