import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarChatResponse, resolveCalendarItemId } from "./calendar-chat";
import type { CalendarItem } from "@/types/calendar";

test("parseCalendarChatResponse extracts reply and create actions", () => {
  const { reply, actions } = parseCalendarChatResponse(
    JSON.stringify({
      reply: "Added the quiz.",
      actions: [
        {
          type: "create",
          title: "Chem quiz",
          kind: "event",
          startsAt: "2026-08-29T15:00:00.000Z",
          allDay: false,
          important: true,
        },
      ],
    })
  );
  assert.equal(reply, "Added the quiz.");
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "create");
  if (actions[0]?.type === "create") {
    assert.equal(actions[0].title, "Chem quiz");
    assert.equal(actions[0].important, true);
  }
});

test("resolveCalendarItemId matches title when id is missing", () => {
  const items: CalendarItem[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Chem quiz",
      notes: "",
      kind: "event",
      startsAt: null,
      endsAt: null,
      allDay: true,
      important: true,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
  assert.equal(
    resolveCalendarItemId("Chem quiz", items),
    "11111111-1111-4111-8111-111111111111"
  );
});
