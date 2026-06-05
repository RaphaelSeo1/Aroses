export type CollaboratorRole = "owner" | "editor" | "viewer";

export type CollaboratorStatus = "pending" | "accepted" | "declined" | "revoked";

export type CourseCollaboratorRow = {
  id: string;
  course_id: string;
  user_id: string | null;
  invited_email: string | null;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
};

export type CollaboratorListItem = {
  id: string;
  userId: string | null;
  invitedEmail: string | null;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  displayName: string | null;
  username: string | null;
  invitedAt: string;
  acceptedAt: string | null;
};

export type ViewerCourseRole = CollaboratorRole | null;
