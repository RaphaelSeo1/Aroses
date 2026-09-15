import assert from "node:assert/strict";
import test from "node:test";
import { buildSrsSessionUrl } from "./srs-session-query.ts";

test("builds the default review-session URL", () => {
  assert.equal(buildSrsSessionUrl({}), "/api/srs/session?scope=both");
});

test("includes dashboard selection and review type", () => {
  assert.equal(
    buildSrsSessionUrl({
      scope: "personal",
      materialIds: ["material-a", "material-b"],
    }),
    "/api/srs/session?scope=personal&materialIds=material-a%2Cmaterial-b"
  );
});

test("includes noteIds even when the list is empty", () => {
  assert.equal(
    buildSrsSessionUrl({
      scope: "both",
      materialIds: ["material-a"],
      noteIds: [],
    }),
    "/api/srs/session?scope=both&materialIds=material-a&noteIds="
  );
});

test("preserves all supported session options", () => {
  assert.equal(
    buildSrsSessionUrl({
      scope: "module",
      materialId: "material-a",
      moduleId: 3,
      newLimit: 7,
      maxReviews: 25,
      cram: true,
    }),
    "/api/srs/session?scope=module&materialId=material-a&moduleId=3&newLimit=7&maxReviews=25&cram=1"
  );
});
