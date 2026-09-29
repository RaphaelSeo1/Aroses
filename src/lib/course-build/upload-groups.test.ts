import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addSingles,
  buildRequests,
  combineWith,
  defaultUnitName,
  moveSource,
  nudgeSource,
  removeSource,
  renameUnit,
  separateSource,
  ungroup,
  unitPages,
  unitTitle,
  type UploadSource,
  type UploadUnit,
} from "./upload-groups.ts";

const sources: UploadSource[] = [
  { key: "a", type: "file", name: "Lec 3 Viruses.pdf" },
  { key: "b", type: "file", name: "Lec 3 slides.pptx" },
  { key: "c", type: "file", name: "Recording.m4a" },
  { key: "t", type: "text", label: "Pasted text", text: "Notes from the review session on viral replication." },
  { key: "u", type: "url", url: "https://www.example.edu/viruses" },
];
const byKey = new Map(sources.map((s) => [s.key, s]));
const paths = new Map([
  ["a", "user/a.pdf"],
  ["b", "user/b.pptx"],
  ["c", "user/c.m4a"],
]);
const keysOf = (units: UploadUnit[]) => units.map((u) => u.keys);

test("every source starts as its own material, and each becomes its own build with no title", () => {
  const units = addSingles([], ["a", "b", "c"]);
  assert.deepEqual(keysOf(units), [["a"], ["b"], ["c"]]);
  const reqs = buildRequests(units, byKey, paths);
  assert.equal(reqs.length, 3);
  assert.ok(reqs.every((r) => r.title === null));
  assert.deepEqual(reqs[0]!.sources, [{ type: "file", storagePath: "user/a.pdf", name: "Lec 3 Viruses.pdf" }]);
  assert.deepEqual(addSingles(units, ["a"]), units, "adding a source twice is a no-op");
});

test("dropping one file on another combines them; more files can join, and order is reading order", () => {
  let units = addSingles([], ["a", "b", "c", "t"]);
  units = combineWith(units, "b", "a");
  assert.deepEqual(keysOf(units), [["a", "b"], ["c"], ["t"]]);
  units = combineWith(units, "t", "a", "before");
  assert.deepEqual(keysOf(units), [["t", "a", "b"], ["c"]]);
  units = moveSource(units, "c", units[0]!.id, 99);
  assert.deepEqual(keysOf(units), [["t", "a", "b", "c"]]);

  // Reorder within the group by dragging and with the up/down buttons.
  units = combineWith(units, "t", "c", "after");
  assert.deepEqual(keysOf(units), [["a", "b", "c", "t"]]);
  units = nudgeSource(units, "c", -1);
  assert.deepEqual(keysOf(units), [["a", "c", "b", "t"]]);
  assert.deepEqual(nudgeSource(units, "a", -1), units, "the first source can't move up");

  const [req] = buildRequests(units, byKey, paths);
  assert.deepEqual(req!.keys, ["a", "c", "b", "t"]);
  assert.deepEqual(
    req!.sources.map((s) => s.type),
    ["file", "file", "file", "text"]
  );
  assert.equal(req!.title, "Lec 3 Viruses", "a combined material is named after its first file, without the extension");
});

test("dragging a file out separates it, right after the group it left", () => {
  let units = addSingles([], ["a", "b", "c", "u"]);
  units = combineWith(units, "b", "a");
  units = combineWith(units, "c", "b");
  units = separateSource(units, "b");
  assert.deepEqual(keysOf(units), [["a", "c"], ["b"], ["u"]]);
  assert.equal(new Set(units.map((u) => u.id)).size, units.length, "unit ids stay unique");
  units = separateSource(units, "a");
  assert.deepEqual(keysOf(units), [["c"], ["a"], ["b"], ["u"]]);
  assert.equal(new Set(units.map((u) => u.id)).size, units.length);
  assert.ok(units.every((u) => u.name === null));
});

test("names default to the first source, can be renamed, and reset when the group breaks up", () => {
  let units = combineWith(addSingles([], ["a", "b", "u"]), "u", "a");
  const g = units[0]!;
  assert.equal(defaultUnitName(g, byKey), "Lec 3 Viruses");
  units = renameUnit(units, g.id, "  Week 3:   Viruses ");
  assert.equal(unitTitle(units[0]!, byKey), "Week 3: Viruses");
  units = renameUnit(units, g.id, "   ");
  assert.equal(unitTitle(units[0]!, byKey), "Lec 3 Viruses", "a blank name falls back to the default");
  units = renameUnit(units, g.id, "Viruses");
  // Moving the link first changes the default, not a typed name.
  units = nudgeSource(units, "u", -1);
  assert.equal(unitTitle(units[0]!, byKey), "Viruses");
  units = removeSource(units, "a");
  assert.deepEqual(keysOf(units), [["u"], ["b"]]);
  assert.equal(units[0]!.name, null, "back to one source, the name is dropped");
  assert.equal(buildRequests(units, byKey, paths)[0]!.title, null);

  const links = combineWith(addSingles([], ["u", "a"]), "a", "u");
  assert.equal(defaultUnitName(links[0]!, byKey), "example.edu");
});

test("uncombine splits a group into one material per source, in order", () => {
  let units = addSingles([], ["a", "b", "c"]);
  units = combineWith(units, "b", "a");
  units = combineWith(units, "c", "a");
  assert.deepEqual(keysOf(units), [["a", "c", "b"]]);
  units = ungroup(units, units[0]!.id);
  assert.deepEqual(keysOf(units), [["a"], ["c"], ["b"]]);
  assert.equal(new Set(units.map((u) => u.id)).size, 3);
});

test("mixed singles and groups give one build per unit, texts and links kept in place", () => {
  let units = addSingles([], ["a", "b", "c", "t", "u"]);
  units = combineWith(units, "t", "b");
  units = combineWith(units, "u", "c", "before");
  units = renameUnit(units, units[2]!.id, "Guest lecture");
  const reqs = buildRequests(units, byKey, paths);
  assert.deepEqual(
    reqs.map((r) => ({ title: r.title, keys: r.keys })),
    [
      { title: null, keys: ["a"] },
      { title: "Lec 3 slides", keys: ["b", "t"] },
      { title: "Guest lecture", keys: ["u", "c"] },
    ]
  );
  assert.deepEqual(reqs[1]!.sources[1], { type: "text", label: "Pasted text", text: "Notes from the review session on viral replication." });
  assert.deepEqual(reqs[2]!.sources[0], { type: "url", url: "https://www.example.edu/viruses" });
  assert.throws(() => buildRequests(units, byKey, new Map()), /not uploaded/);
});

test("app sources are sent by kind and id", () => {
  const app: UploadSource = { key: "n", type: "app", kind: "live_session", id: "11111111-1111-1111-1111-111111111111", label: "Lecture 4 notes" };
  const map = new Map([...byKey, ["n", app]]);
  const units = combineWith(addSingles([], ["n", "a"]), "a", "n");
  const [req] = buildRequests(units, map, paths);
  assert.equal(req!.title, "Lecture 4 notes");
  assert.deepEqual(req!.sources[0], { type: "app", kind: "live_session", id: app.id });
});

test("page totals per material add up its sources and flag ones the build must count", () => {
  const units = combineWith(addSingles([], ["a", "b", "u"]), "b", "a");
  assert.deepEqual(unitPages(units[0]!, { a: 12, b: 30 }), { pages: 42, counting: false, uncounted: false });
  assert.deepEqual(unitPages(units[0]!, { a: 12, b: "counting" }), { pages: 12, counting: true, uncounted: false });
  assert.deepEqual(unitPages(units[1]!, { u: null }), { pages: 0, counting: false, uncounted: true });
});

test("moves that change nothing return the same arrangement", () => {
  const units = addSingles([], ["a", "b"]);
  assert.equal(combineWith(units, "a", "a"), units);
  assert.equal(moveSource(units, "a", "missing", 0), units);
  assert.equal(moveSource(units, "a", units[0]!.id, 0), units);
  assert.equal(separateSource(units, "a"), units);
});
