export type CalendarKind = "todo" | "event";

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
};
