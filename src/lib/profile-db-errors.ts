/** Missing optional column `study_focus` (migration 015 not applied). */
export function isStudyFocusColumnError(message: string | undefined): boolean {
  return /study_focus|schema cache/i.test(message ?? "");
}
