import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { prepareRasterCrop } from "./figure-crop.ts";

function png(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 400, h = 300): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  draw(ctx as unknown as CanvasRenderingContext2D, w, h);
  return canvas.toBuffer("image/png");
}

test("empty paper and specks are dropped", async () => {
  assert.equal(await prepareRasterCrop(png(() => {}, 120, 120)), null);
  const speck = png((ctx) => {
    ctx.fillStyle = "#111111";
    ctx.fillRect(40, 40, 3, 3);
  }, 200, 200);
  assert.equal(await prepareRasterCrop(speck), null);
});

test("a drawing on a large white canvas is recropped to the ink", async () => {
  const input = png((ctx) => {
    ctx.fillStyle = "#2a6fdb";
    ctx.fillRect(30, 180, 90, 70);
  });
  const out = await prepareRasterCrop(input);
  assert.ok(out);
  assert.ok(out.box.w < 0.4 && out.box.h < 0.4, "the white margin is gone");
  assert.ok(Math.abs(out.box.x * 400 - 24) < 3);
  assert.ok(Math.abs(out.box.y * 300 - 174) < 3);
});

test("a full-bleed figure is left as it is", async () => {
  const input = png((ctx, w, h) => {
    ctx.fillStyle = "#228855";
    ctx.fillRect(0, 0, w, h);
  }, 80, 80);
  const out = await prepareRasterCrop(input);
  assert.ok(out);
  assert.equal(out.buffer, input);
  assert.deepEqual(out.box, { x: 0, y: 0, w: 1, h: 1 });
});

test("a QR code on the edge of a colored figure is removed", async () => {
  const input = png((ctx) => {
    ctx.fillStyle = "#3cb44b";
    ctx.fillRect(40, 80, 200, 160);
    const finder = (x: number, y: number) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, 22, 22);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 4, y + 4, 14, 14);
      ctx.fillStyle = "#000000";
      ctx.fillRect(x + 8, y + 8, 6, 6);
    };
    finder(300, 0);
    finder(330, 0);
    finder(360, 0);
  });
  const out = await prepareRasterCrop(input);
  assert.ok(out);
  assert.ok(out.box.x + out.box.w < 0.72, "the edge code is outside the crop");
  assert.ok(out.box.w > 0.4, "the diagram itself stays");
});

test("a black-and-white diagram keeps marks in its corners", async () => {
  const input = png((ctx, w, h) => {
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 40, w - 70, h - 80);
    ctx.fillStyle = "#111111";
    ctx.fillRect(w - 48, 8, 36, 36);
  });
  const out = await prepareRasterCrop(input);
  assert.ok(out);
  assert.ok(out.box.x + out.box.w > 0.9, "the corner mark is part of the drawing");
});
