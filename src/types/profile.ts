export type UserProfileRow = {
  display_name: string | null;
  /** Public handle, lowercase a-z0-9_ (3–30 chars). */
  username: string | null;
  birthday: string | null;
  bio: string | null;
  /** Public Storage URL for profile image, or null. */
  avatar_url: string | null;
  /** student | instructor | professional | hobby | other */
  study_focus: string | null;
  /** University or school from onboarding / settings. */
  school_name: string | null;
};
