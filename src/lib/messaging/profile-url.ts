/** Update profile URL without a Next.js navigation (instant tab/chat switches). */
export function replaceProfileUrl(input: {
  tab?: string;
  conversation?: string | null;
}): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (input.tab) url.searchParams.set("tab", input.tab);
  else url.searchParams.delete("tab");
  if (input.conversation) url.searchParams.set("conversation", input.conversation);
  else url.searchParams.delete("conversation");
  window.history.replaceState(null, "", url);
}
