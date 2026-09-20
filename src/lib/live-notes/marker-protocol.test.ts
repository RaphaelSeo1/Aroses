import assert from "node:assert/strict";
import test from "node:test";
import { createMarkerParser } from "./marker-protocol";

test("unsupported destructive markers and their bodies are swallowed", () => {
  const parser = createMarkerParser(new Set(["s1", "s2"]), "new");
  const events = [
    ...parser.push(
      "@@revise s1\n- Safe addition.\n@@rewrite s1\n## Unsafe replacement\n- Must not leak.\n@@remove s2\n@@append\n"
    ),
    ...parser.flush(),
  ];
  assert.deepEqual(
    events.filter((event) => event.type === "op"),
    [
      { type: "op", op: "revise", sectionId: "s1" },
      { type: "op", op: "append", sectionId: "new" },
    ]
  );
  assert.ok(
    events.some(
      (event) => event.type === "text" && event.delta.includes("Safe addition")
    )
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "text" &&
        (event.delta.includes("Unsafe replacement") ||
          event.delta.includes("Must not leak"))
    ),
    false
  );
});
