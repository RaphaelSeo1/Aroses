import assert from "node:assert/strict";
import test from "node:test";
import {
  hubSectionAutoExpandsOnSelect,
  initialHubExpandedSectionIds,
  MY_NOTES_HUB_SECTION_ID,
} from "./hub-sidebar-expand.ts";

const SECTIONS = [
  { id: "standalone" },
  { id: "custom:folder" },
  { id: "live" },
];

test("My notes does not auto-expand on select", () => {
  assert.equal(hubSectionAutoExpandsOnSelect(MY_NOTES_HUB_SECTION_ID), false);
  assert.equal(hubSectionAutoExpandsOnSelect("live"), true);
  assert.equal(hubSectionAutoExpandsOnSelect("custom:folder"), true);
});

test("initial expand state keeps My notes collapsed even when it is active", () => {
  assert.deepEqual(
    initialHubExpandedSectionIds(SECTIONS, "standalone"),
    []
  );
});

test("initial expand state still opens a selected folder", () => {
  assert.deepEqual(
    initialHubExpandedSectionIds(SECTIONS, "live"),
    ["live"]
  );
  assert.deepEqual(
    initialHubExpandedSectionIds(SECTIONS, "custom:folder"),
    ["custom:folder"]
  );
});
