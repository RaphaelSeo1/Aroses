import assert from "node:assert/strict";
import test from "node:test";
import {
  boardSvgDocument,
  boardSvgPrompt,
  motionForBoard,
  sanitizeBoardSvg,
  teachingSvgProblems,
  withoutProseLabels,
} from "./board-svg.ts";

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

const WORDS = `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="540" fill="#140c10"/><circle cx="300" cy="270" r="50" fill="#e11d48"/><circle cx="660" cy="270" r="50" fill="#f5c16c"/><text x="480" y="420">chemical bonds</text><text x="480" y="470">forces that hold atoms together</text></svg>`;

const ATOMS = `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg"><style>@keyframes share { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-12px) } } .e { animation: share 2.4s ease-in-out infinite }</style><rect width="960" height="540" fill="#140c10"/><circle cx="360" cy="250" r="90" fill="none" stroke="#e11d48" stroke-width="4"/><circle cx="600" cy="250" r="90" fill="none" stroke="#f5c16c" stroke-width="4"/><ellipse cx="480" cy="250" rx="36" ry="18" fill="#7eb6ff"/><circle class="e" cx="480" cy="232" r="8" fill="#fff7f4"/><circle cx="480" cy="268" r="8" fill="#fff7f4"/><path d="M430 250 H530" stroke="#7eb6ff" stroke-width="3"/></svg>`;

test("words on generic shapes are not a teaching picture", () => {
  const problems = teachingSvgProblems(WORDS, {
    title: "What a Chemical Bond Is",
    brief: "Two atoms share electrons in the space between them.",
    motion: "The shared electrons stay between the atoms.",
  });
  assert.ok(problems.length > 0);
});

test("atoms and moving electrons are a teaching picture", () => {
  const problems = teachingSvgProblems(ATOMS, {
    title: "What a Chemical Bond Is",
    brief: "Two atoms share electrons in the space between them.",
    motion: "The shared electrons drift between the atoms.",
  });
  assert.deepEqual(problems, []);
});

test("a sentence caption is removed and the drawing stays", () => {
  const svg = `<svg viewBox="0 0 960 540"><text x="10" y="20">HA</text><text x="10" y="40">acid drops sharply here now</text></svg>`;
  const cleaned = withoutProseLabels(svg);
  assert.match(cleaned, />HA</);
  assert.doesNotMatch(cleaned, /sharply/);
});

test("a formula on a real drawing is part of the picture", () => {
  const rice = `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg"><style>@keyframes drip { 0%,100% { transform: translateY(0) } 50% { transform: translateY(10px) } } .d { animation: drip 2.4s ease-in-out infinite }</style><rect width="960" height="540" fill="#140c10"/><path d="M40 300 H280 V420 H40 Z" fill="#1f3a5f"/><circle class="d" cx="90" cy="360" r="16" fill="#e11d48"/><circle cx="140" cy="360" r="16" fill="#f5c16c"/><circle cx="190" cy="360" r="16" fill="#7eb6ff"/><ellipse cx="160" cy="340" rx="40" ry="14" fill="none" stroke="#fff7f4"/><line x1="300" y1="80" x2="300" y2="460" stroke="#fff7f4"/><line x1="300" y1="460" x2="860" y2="460" stroke="#fff7f4"/><path d="M320 420 C 480 400, 620 180, 820 80" fill="none" stroke="#7eb6ff" stroke-width="4"/><text x="160" y="450">HA ⇌ A⁻ + H₃O⁺</text></svg>`;
  assert.deepEqual(
    teachingSvgProblems(rice, {
      title: "RICE tables for weak acid-base systems",
      brief: "A weak acid sits in water. The table records initial, change, and equilibrium amounts.",
    }),
    []
  );
});

test("a picture that fades in from nothing is rejected", () => {
  const hidden = `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg"><style>@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } } .p { animation: fadeIn 0.8s ease both }</style><rect width="960" height="540" fill="#140c10"/><circle class="p" cx="200" cy="200" r="40" fill="#fff7f4"/><circle class="p" cx="400" cy="200" r="40" fill="#f5c16c"/><ellipse class="p" cx="600" cy="220" rx="50" ry="30" fill="#7eb6ff"/><path class="p" d="M120 360 H840" stroke="#e11d48" stroke-width="4"/></svg>`;
  const problems = teachingSvgProblems(hidden, {
    title: "A structure",
    brief: "Three parts sit in a row on a folded line.",
  });
  assert.ok(problems.includes("the picture starts invisible"));
});

test("a process brief asks for object motion and the prompt forbids the title", () => {
  assert.match(motionForBoard("Protons flow back through the enzyme."), /Move the object/);
  assert.equal(motionForBoard("A mitochondrion has an inner membrane folded into cristae."), "");
  const prompt = boardSvgPrompt({
    title: "Party platforms and policy approaches",
    brief: "One party treats government as a protector. The other treats it as an intruder.",
    labels: ["Progressive/Liberal Position"],
    problems: ["generic shapes instead of the object"],
  });
  assert.match(prompt, /do not letter this onto the board/i);
  assert.match(prompt, /generic shapes/);
  assert.equal(prompt.includes("Draw a membrane"), false);
});
