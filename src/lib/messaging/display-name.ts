import type { FriendProfile } from "@/lib/messaging/types";

export function friendDisplayName(p: FriendProfile): string {
  if (p.displayName?.trim()) return p.displayName.trim();
  if (p.username?.trim()) return `@${p.username.trim()}`;
  return "User";
}

export function conversationTitle(
  isGroup: boolean,
  title: string | null,
  participants: FriendProfile[]
): string {
  if (isGroup && title?.trim()) return title.trim();
  if (participants.length === 1) return friendDisplayName(participants[0]!);
  if (participants.length > 1) {
    return participants.map(friendDisplayName).join(", ");
  }
  return "Conversation";
}
