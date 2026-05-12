export type UserProfileRow = {
  display_name: string | null;
  birthday: string | null;
  bio: string | null;
  /** Public Storage URL for profile image, or null. */
  avatar_url: string | null;
  /** student | instructor | professional | hobby | other */
  study_focus: string | null;
};
