import assert from "node:assert/strict";
import { test } from "node:test";
import { stripChoiceLetterPrefix } from "./quiz-choice-text.ts";

test("strips A) B. C: D- prefixes", () => {
  assert.equal(
    stripChoiceLetterPrefix("C) The member is responsible for balance billing"),
    "The member is responsible for balance billing"
  );
  assert.equal(stripChoiceLetterPrefix("A. Insulin"), "Insulin");
  assert.equal(stripChoiceLetterPrefix("b: Keratin"), "Keratin");
  assert.equal(stripChoiceLetterPrefix("D - Pepsin"), "Pepsin");
});

test("strips stacked prefixes from generation + leftover letter", () => {
  assert.equal(
    stripChoiceLetterPrefix("A. C) The provider absorbs the cost"),
    "The provider absorbs the cost"
  );
});

test("leaves real answers that start with a letter word alone", () => {
  assert.equal(stripChoiceLetterPrefix("Adenosine triphosphate"), "Adenosine triphosphate");
  assert.equal(stripChoiceLetterPrefix("Balance billing"), "Balance billing");
});
