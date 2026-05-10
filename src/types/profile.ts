export type UserProfileRow = {
  display_name: string | null;
  birthday: string | null;
  bio: string | null;
  timezone: string | null;
  /** student | instructor | professional | hobby | other */
  study_focus: string | null;
};
