import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicUnauthenticatedPath,
  nextPathForUnauthenticated,
  unauthenticatedHomePath,
  unauthenticatedProductEntryPath,
} from "./public-routes.ts";

test("marketing, legal, help, and auth stay public for guests", () => {
  for (const path of [
    "/intro",
    "/help",
    "/legal/terms",
    "/legal/privacy",
    "/auth/callback",
    "/login",
    "/signup",
    "/reset-password",
    "/share/abc",
    "/share/session/tok",
    "/brand",
  ]) {
    assert.equal(isPublicUnauthenticatedPath(path), true, path);
  }
});

test("core product surfaces are not public for guests", () => {
  for (const path of [
    "/",
    "/notes",
    "/notes/doc/1",
    "/dashboard",
    "/dashboard/review",
    "/dashboard/courses/new",
    "/explore",
    "/explore/4b2be649-2da4-4790-a71c-36de0adf704e",
    "/tutor-session",
    "/calendar",
    "/forum",
    "/onboarding",
    "/sessions",
    "/library/courses",
    "/friends",
    "/messages",
  ]) {
    assert.equal(isPublicUnauthenticatedPath(path), false, path);
  }
});

test("guests hitting the product hub land on intro; other product URLs go to signup", () => {
  assert.equal(unauthenticatedHomePath(), "/intro");
  assert.equal(unauthenticatedProductEntryPath(), "/signup");
  assert.equal(nextPathForUnauthenticated("/", "/"), "/");
  assert.equal(
    nextPathForUnauthenticated("/notes", "/notes"),
    "/notes"
  );
});
