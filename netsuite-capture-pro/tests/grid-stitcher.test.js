import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GridStitcher } from '../image/grid-stitcher.js';

let draws;
let closed;
const frame = (x, y) => ({ horizontalOffset: x, offset: y, totalWidth: 1000, totalHeight: 700,
  clip: { x: 10, y: 20, width: 600, height: 400 }, viewportWidth: 640, viewportHeight: 480 });
const png = 'data:image/png;base64,eA==';
beforeEach(() => {
  draws = [];
  closed = 0;
  globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close: () => closed++ });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { fillRect() {}, drawImage: (...args) => draws.push(args) }; }
    async convertToBlob() { return new Blob(['png'], { type: 'image/png' }); }
  };
});

test('two-dimensional overlap is removed at fractional device scale and clamped edges', async () => {
  const stitcher = new GridStitcher();
  for (const [x,y] of [[0,0],[400,0],[0,300],[400,300]]) await stitcher.append(png, frame(x,y));
  assert.equal(stitcher.canvas.width, 1250);
  assert.equal(stitcher.canvas.height, 875);
  assert.deepEqual(draws.map((args) => args.slice(5)), [
    [0,0,750,500], [750,0,500,500], [0,500,750,375], [750,500,500,375]
  ]);
  assert.equal(closed, 4);
  assert.match(await stitcher.toPng(), /^data:image\/png;base64,/);
  stitcher.dispose();
  assert.equal(stitcher.canvas, undefined);
});

test('an incomplete horizontal strip cannot be exported', async () => {
  const stitcher = new GridStitcher();
  await stitcher.append(png, frame(0,0));
  await assert.rejects(stitcher.toPng(), /Not all horizontal columns/);
  stitcher.dispose();
});

test('missing horizontal pixels, width changes and vertical movement are rejected', async () => {
  const missing = new GridStitcher();
  await assert.rejects(missing.append(png, frame(400,0)), /gap/);
  missing.dispose();
  const changed = new GridStitcher();
  await changed.append(png, frame(0,0));
  await assert.rejects(changed.append(png, { ...frame(400,0), totalWidth:1100 }), /width changed/);
  await assert.rejects(changed.append(png, frame(400,100)), /gap/);
  changed.dispose();
});

test('all-columns crops touching both viewport edges retain fractional source coordinates', async () => {
  const stitcher = new GridStitcher();
  const edgeFrame = (x, y) => ({ ...frame(x,y), totalWidth: 1000, totalHeight: 800,
    clip: { x: 14, y: 14, width: 626, height: 466 } });
  for (const [x,y] of [[0,0],[374,0],[0,334],[374,334]]) await stitcher.append(png, edgeFrame(x,y));
  assert.equal(stitcher.canvas.width, 1250);
  assert.equal(stitcher.canvas.height, 1000);
  assert.equal(draws[0][1], 17.5);
  assert.equal(draws[0][2], 17.5);
  for (const draw of draws) {
    assert.ok(draw[1] + draw[3] <= 800);
    assert.ok(draw[2] + draw[4] <= 600);
  }
  assert.match(await stitcher.toPng(), /^data:image\/png;base64,/);
  stitcher.dispose();
});

test('all-columns crops account for separately rounded screenshot height', async () => {
  globalThis.createImageBitmap = async () => ({ width:800, height:599, close:()=>closed++ });
  const stitcher = new GridStitcher();
  const metrics = { ...frame(0,0), totalWidth:640, totalHeight:480,
    clip: { x:0, y:0, width:640, height:480 } };
  await stitcher.append(png, metrics);
  assert.equal(draws[0][4], 599);
  assert.match(await stitcher.toPng(), /^data:image\/png;base64,/);
  stitcher.dispose();
});

test('all-columns still rejects materially out-of-view content', async () => {
  const stitcher = new GridStitcher();
  await assert.rejects(stitcher.append(png, { ...frame(0,0), clip:{ x:100, y:20, width:600, height:400 } }), /outside the screenshot/);
  assert.equal(closed, 1);
  stitcher.dispose();
});
