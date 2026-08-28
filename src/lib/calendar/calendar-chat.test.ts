import assert from "node:assert/strict";
import test from "node:test";
import {
  actionFromToolUse,
  coerceStartsAt,
  parseCalendarChatResponse,
  parseCalendarModelContent,
  resolveCalendarItemId,
} from "./calendar-chat";
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
      sectionId: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
  assert.equal(
    resolveCalendarItemId("Chem quiz", items),
    "11111111-1111-4111-8111-111111111111"
  );
});

test("coerceStartsAt treats naive datetimes as wall clock in the zone", () => {
  assert.equal(
    coerceStartsAt("2026-08-28T15:00", "America/Los_Angeles"),
    "2026-08-28T22:00:00.000Z"
  );
  assert.equal(
    coerceStartsAt("2026-08-28", "America/Los_Angeles"),
    "2026-08-28T16:00:00.000Z"
  );
});

test("actionFromToolUse builds a timed create from date + time", () => {
  const action = actionFromToolUse("create_item", {
    title: "Chem quiz",
    kind: "event",
    date: "2026-08-28",
    time: "3:00 pm",
    important: true,
  });
  assert.equal(action?.type, "create");
  if (action?.type === "create") {
    assert.equal(action.startsAt, "2026-08-28T15:00");
    assert.equal(action.allDay, false);
    assert.equal(action.kind, "event");
  }
});

test("parseCalendarModelContent prefers tool_use over JSON-in-text", () => {
  const { reply, actions } = parseCalendarModelContent([
    { type: "text", text: "Added chem quiz Friday at 3." },
    {
      type: "tool_use",
      name: "create_item",
      input: {
        title: "Chem quiz",
        kind: "event",
        date: "2026-08-28",
        time: "15:00",
      },
    },
  ]);
  assert.equal(reply, "Added chem quiz Friday at 3.");
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "create");
});
