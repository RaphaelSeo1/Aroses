/** Optional embed URLs — drop a YouTube or Vimeo link to auto-show on /help. */
import type { UiLocale } from "@/lib/i18n/config";
import { helpContent } from "@/locales/help-content";

export type HelpVideo = {
  id: string;
  title: string;
  description: string;
  /** e.g. https://www.youtube.com/embed/VIDEO_ID */
  embedUrl: string | null;
  durationLabel?: string;
};

const EMBED_URLS: Record<string, string | null> = {
  "quick-start": null,
  "build-course": null,
  mentored: null,
  "free-explore": null,
  review: null,
  "tutor-session": null,
};

export function getHelpVideos(locale: UiLocale): HelpVideo[] {
  return helpContent[locale].videos.items.map((item) => ({
    ...item,
    embedUrl: EMBED_URLS[item.id] ?? null,
  }));
}

/** @deprecated Use getHelpVideos(locale) */
export const HELP_VIDEOS = getHelpVideos("en");
