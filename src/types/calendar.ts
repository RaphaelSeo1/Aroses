export type CalendarKind = "todo" | "event";

export type CalendarTodoSection = {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: string;
};

export type CalendarItem = {
  id: string;
  title: string;
  notes: string;
  kind: CalendarKind;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  important: boolean;
  completedAt: string | null;
  sectionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarItemInput = {
  title: string;
  notes?: string;
  kind?: CalendarKind;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean;
  important?: boolean;
  completedAt?: string | null;
  sectionId?: string | null;
};
