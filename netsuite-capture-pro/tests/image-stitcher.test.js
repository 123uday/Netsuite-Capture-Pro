import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ImageStitcher, sourceRectangle, framePlacement } from '../image/image-stitcher.js';

const metrics = (offset = 0) => ({ offset, totalHeight: 1172,
  clip: { x: 0, y: 14, width: 800, height: 586 }, viewportWidth: 800, viewportHeight: 600 });
const bitmap = { width: 1000, height: 750 };

test('a crop touching the viewport bottom stays within the bitmap at 125% scale', () => {
  const frame = metrics();
  const placement = framePlacement(frame, 1.25, 0);
  // Regression: the old independently rounded source was y=18, height=733,
  // exceeding the 750-pixel screenshot even though the DOM crop fits exactly.
  assert.equal(Math.round(frame.clip.y * 1.25) + placement.height, 751);
  const source = sourceRectangle(frame, bitmap, placement);
  assert.equal(source.y, 17.5);
  assert.equal(source.height, 732.5);
  assert.equal(source.y + source.height, 750);
});

test('fractional right edges and independently rounded bitmap dimensions are supported', () => {
  const frame = { ...metrics(), clip: { x: 14, y: 0, width: 786, height: 600 } };
  const source = sourceRectangle(frame, { width: 1000, height: 749 }, framePlacement(frame, 1.25, 0));
  assert.equal(source.x + source.width, 1000);
  assert.equal(source.y + source.height, 749);
});

test('large crop errors still fail rather than silently losing content', () => {
  const frame = { ...metrics(), clip: { x: 0, y: 30, width: 800, height: 586 } };
  assert.throws(() => sourceRectangle(frame, bitmap, framePlacement(frame, 1.25, 0)), /extends outside/);
});

let draws;
beforeEach(() => {
  draws = [];
  globalThis.createImageBitmap = async () => ({ ...bitmap, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage: (...args) => draws.push(args) }; }
    async convertToBlob() { return new Blob(['png'], { type: 'image/png' }); }
  };
});

test('visible-column PNG stitches fractional edge frames with no missing destination rows', async () => {
  const stitcher = new ImageStitcher();
  await stitcher.append('data:image/png;base64,eA==', metrics());
  await stitcher.append('data:image/png;base64,eA==', metrics(586));
  assert.equal(stitcher.canvas.height, 1465);
  assert.equal(draws[0][6], 0);
  assert.equal(draws[0][8], 733);
  assert.equal(draws[1][6], 733);
  assert.equal(draws[1][8], 732);
  for (const draw of draws) assert.ok(draw[2] + draw[4] <= bitmap.height);
  assert.match(await stitcher.toPng(), /^data:image\/png;base64,/);
  stitcher.dispose();
});
