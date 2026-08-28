import assert from "node:assert/strict";
import test from "node:test";
import { speakableText } from "./speakable-text";

test("speakableText strips markdown chrome but keeps the words", () => {
  assert.equal(speakableText("**hello** _world_"), "hello world");
  assert.equal(
    speakableText("## Title\n- one\n- two\nSee [docs](https://x.test)."),
    "Title one two See docs."
  );
  assert.equal(speakableText(""), "");
});
