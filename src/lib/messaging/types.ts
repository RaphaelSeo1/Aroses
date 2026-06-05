export type FriendshipStatus = "pending" | "accepted" | "declined" | "blocked";

export type FriendProfile = {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type ConversationMember = FriendProfile & {
  role: "member" | "admin";
  isSelf: boolean;
};

export type FriendshipListItem = {
  id: string;
  status: FriendshipStatus;
  direction: "incoming" | "outgoing" | "none";
  friend: FriendProfile;
  createdAt: string;
  acceptedAt: string | null;
};

export type ConversationType = "direct" | "group";

export type ConversationListItem = {
  id: string;
  type: ConversationType;
  title: string | null;
  courseId: string | null;
  courseTitle: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  participants: FriendProfile[];
  isGroup: boolean;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  senderDisplayName: string | null;
  senderUsername: string | null;
  contextCourseId: string | null;
  contextMaterialId: string | null;
  contextModuleId: number | null;
  contextLessonIndex: number | null;
  contextLabel: string | null;
  createdAt: string;
  isOwn: boolean;
};
