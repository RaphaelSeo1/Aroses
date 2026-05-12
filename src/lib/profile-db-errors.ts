/** Missing optional column `study_focus` (migration 015 not applied). */
export function isStudyFocusColumnError(message: string | undefined): boolean {
  return /study_focus|schema cache/i.test(message ?? "");
}

/** Missing optional column `avatar_url` (migration 023 not applied). */
export function isAvatarUrlColumnError(message: string | undefined): boolean {
  return /avatar_url|schema cache/i.test(message ?? "");
}

/** Missing optional column `school_name` (migration 026 not applied). */
export function isSchoolNameColumnError(message: string | undefined): boolean {
  return /school_name|schema cache/i.test(message ?? "");
}

/** Missing optional column `username` (migration 026 not applied). */
export function isUsernameColumnError(message: string | undefined): boolean {
  const m = message ?? "";
  if (/profiles_username_lower_key|unique|duplicate/i.test(m)) return false;
  return (
    /\busername\b/i.test(m) &&
    /does not exist|could not find|schema cache/i.test(m)
  );
}
