/** Root all-notes group in the hub sidebar ("My notes"). */
export const MY_NOTES_HUB_SECTION_ID = "standalone";

/**
 * Folders auto-open when selected. The root My notes list is long, so it
 * stays collapsed until the user expands it (chevron or section click).
 */
export function hubSectionAutoExpandsOnSelect(sectionId: string): boolean {
  return sectionId !== MY_NOTES_HUB_SECTION_ID;
}

export function initialHubExpandedSectionIds(
  sections: Array<{ id: string }>,
  activeSectionId: string
): string[] {
  const active = sections.find((s) => s.id === activeSectionId);
  const candidate = active?.id ?? sections[0]?.id;
  if (!candidate || !hubSectionAutoExpandsOnSelect(candidate)) return [];
  return [candidate];
}
