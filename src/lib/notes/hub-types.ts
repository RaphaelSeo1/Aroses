/** Typed reference for bulk actions on the Notes hub (delete, etc.). */
export type NoteHubRef =
  | { kind: "standalone"; id: string }
  | { kind: "tutor"; id: string }
  | { kind: "live"; id: string }
  | { kind: "course"; materialId: string }
  | { kind: "lesson"; materialId: string };

export type NoteHubSection = {
  id: string;
  title: string;
  hint: string;
  cards: NoteDocCardData[];
};

export type NoteDocCardData = {
  key: string;
  href: string;
  title: string;
  subtitle?: string | null;
  preview?: string | null;
  dateLabel: string;
  isLive?: boolean;
  chip?: { label: string; tone: "live" | "paused" | "done" | "failed" };
  ref?: NoteHubRef;
  /** When false, card cannot be bulk-deleted (e.g. active live recording). */
  deletable?: boolean;
};
