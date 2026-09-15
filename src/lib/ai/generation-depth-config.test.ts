import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProfileForDepth,
  depthInstructionBlock,
  parseCourseGenerationDepth,
} from "./generation-depth-config.ts";
import { generationDepthForTier } from "../billing/plans.ts";

test("plan depth is never taken from a client-supplied string unless it is a known depth", () => {
  assert.equal(parseCourseGenerationDepth("maximum"), "maximum");
  assert.equal(parseCourseGenerationDepth("full"), null);
  assert.equal(parseCourseGenerationDepth("essential"), "essential");
  assert.equal(parseCourseGenerationDepth({ fake: true }), null);
});

test("depth maps to an internal build profile and has real instruction text", () => {
  assert.equal(buildProfileForDepth("essential"), "express");
  assert.equal(buildProfileForDepth("standard"), "fast");
  assert.equal(buildProfileForDepth("detailed"), "balanced");
  assert.equal(buildProfileForDepth("comprehensive"), "full");
  assert.equal(buildProfileForDepth("maximum"), "full");
  for (const tier of ["basic", "student", "plus", "advanced", "premium"] as const) {
    const depth = generationDepthForTier(tier);
    const block = depthInstructionBlock(depth);
    assert.match(block, /COURSE DEPTH/);
    assert.ok(block.length > 80);
  }
});
