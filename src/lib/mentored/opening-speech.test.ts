import assert from "node:assert/strict";
import test from "node:test";
import { shouldSpeakFetchedGreeting } from "./opening-speech.ts";

test("the opening greeting speaks while the student is still on Continue", () => {
  assert.equal(
    shouldSpeakFetchedGreeting({
      voice: true,
      alreadyShown: false,
      teachingHasStarted: false,
    }),
    true
  );
});

test("a late greeting stays silent once concept narration has started", () => {
  assert.equal(
    shouldSpeakFetchedGreeting({
      voice: true,
      alreadyShown: false,
      teachingHasStarted: true,
    }),
    false
  );
});

test("a greeting already on screen is not spoken again", () => {
  assert.equal(
    shouldSpeakFetchedGreeting({
      voice: true,
      alreadyShown: true,
      teachingHasStarted: false,
    }),
    false
  );
});

test("text mode never speaks the greeting", () => {
  assert.equal(
    shouldSpeakFetchedGreeting({
      voice: false,
      alreadyShown: false,
      teachingHasStarted: false,
    }),
    false
  );
});
