/** Missing optional column `study_focus` (migration 015 not applied). */
export function isStudyFocusColumnError(message: string | undefined): boolean {
  return /study_focus|schema cache/i.test(message ?? "");
}

/** Missing optional column `avatar_url` (migration 023 not applied). */
export function isAvatarUrlColumnError(message: string | undefined): boolean {
  return /avatar_url|schema cache/i.test(message ?? "");
}
