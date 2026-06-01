/** Optional embed URLs — drop a YouTube or Vimeo link to auto-show on /help. */
export type HelpVideo = {
  id: string;
  title: string;
  description: string;
  /** e.g. https://www.youtube.com/embed/VIDEO_ID */
  embedUrl: string | null;
  durationLabel?: string;
};

export const HELP_VIDEOS: HelpVideo[] = [
  {
    id: "quick-start",
    title: "Quick start — upload to review in 5 minutes",
    description:
      "Sign up, upload a PDF, watch the build, open Mentored Learning, and try a quiz.",
    embedUrl: null,
    durationLabel: "~5 min",
  },
  {
    id: "build-course",
    title: "Building a course (grouping files & sections)",
    description:
      "Combine lecture stacks, set a study goal, manage sections, and make a course public.",
    embedUrl: null,
    durationLabel: "~8 min",
  },
  {
    id: "mentored",
    title: "Mentored Learning with Rose",
    description:
      "Voice vs text, Hold M vs Live mode, notes panel, and check questions.",
    embedUrl: null,
    durationLabel: "~10 min",
  },
  {
    id: "free-explore",
    title: "Free Exploration — read, highlight, ask Rose",
    description:
      "Highlights, study chat, voice dock navigation, and the practice room.",
    embedUrl: null,
    durationLabel: "~8 min",
  },
  {
    id: "review",
    title: "Spaced repetition review",
    description:
      "Review hub, Again/Hard/Good/Easy ratings, and focus cards from your notes.",
    embedUrl: null,
    durationLabel: "~6 min",
  },
  {
    id: "tutor-session",
    title: "Standalone tutor sessions",
    description:
      "Start a session, upload references, live notes, recap, and convert to a course.",
    embedUrl: null,
    durationLabel: "~7 min",
  },
];
