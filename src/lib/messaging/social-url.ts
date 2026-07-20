/** Update /dashboard/social URL without a full Next.js navigation. */
export function replaceSocialUrl(input: {
  tab?: "friends" | "messages";
  conversation?: string | null;
}): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/dashboard/social";
  if (input.tab) url.searchParams.set("tab", input.tab);
  else url.searchParams.delete("tab");
  if (input.conversation) {
    url.searchParams.set("conversation", input.conversation);
  } else {
    url.searchParams.delete("conversation");
  }
  window.history.replaceState(null, "", url);
}

export function socialMessagesHref(conversationId?: string | null): string {
  if (conversationId) {
    return `/dashboard/social?tab=messages&conversation=${encodeURIComponent(conversationId)}`;
  }
  return "/dashboard/social?tab=messages";
}

export function socialFriendsHref(): string {
  return "/dashboard/social?tab=friends";
}
