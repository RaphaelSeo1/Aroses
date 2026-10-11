import assert from "node:assert/strict";
import test from "node:test";
import { boardSvgDocument, sanitizeBoardSvg } from "./board-svg.ts";

const CLEAN = `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg"><style>@keyframes in { from { opacity: 0 } to { opacity: 1 } }</style><rect width="960" height="540" fill="#140c10"/><text x="40" y="80">Stamp Act</text></svg>`;

test("a clean animated svg is kept", () => {
  const svg = sanitizeBoardSvg(`Here is the board:\n${CLEAN}`);
  assert.ok(svg);
  assert.match(svg!, /@keyframes in/);
  assert.match(svg!, /Stamp Act/);
  assert.match(boardSvgDocument(svg!), /<svg/);
});

test("scripts, foreign objects, and remote links are removed", () => {
  const dirty = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div onclick="alert(1)">x</div></foreignObject><image href="https://evil.test/a.png"/><a href="javascript:alert(1)"><text>ok</text></a><rect fill="url(https://evil.test/a.png)"/></svg>`;
  const svg = sanitizeBoardSvg(dirty);
  assert.ok(svg);
  assert.doesNotMatch(svg!, /script|foreignObject|image|onload|javascript|https:/i);
  assert.match(svg!, /<text>ok<\/text>/);
});

test("a reply with no svg is rejected", () => {
  assert.equal(sanitizeBoardSvg("I would draw a membrane."), null);
});
