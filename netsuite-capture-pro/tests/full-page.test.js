import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureFullPage, nextOffset, sameFrame, CONTENT_FILES } from '../capture/full-page-capture.js';
import { checkedDimensions, framePlacement } from '../image/image-stitcher.js';
import { captureVisibleRecord } from '../capture/capture-manager.js';

const frame = (offset = 0, totalHeight = 1500) => ({ offset, totalHeight, clip: { x: 0, y: 80, width: 800, height: 600 },
  viewportWidth: 800, viewportHeight: 700, dpr: 1, kind: 'internal container' });

test('overlap and clamped final frame produce contiguous pixel placement', () => {
  const first = framePlacement(frame(0), 1.25, 0);
  assert.equal(first.height, 750);
  const second = framePlacement(frame(504), 1.25, first.end);
  assert.deepEqual(second, { sourceY: 220, destY: 750, height: 630, end: 1380 });
  const last = framePlacement(frame(900), 1.25, second.end);
  assert.equal(last.end, 1875);
  assert.equal(last.height, 495);
  assert.equal(first.height + second.height + last.height, 1875);
  assert.equal(nextOffset(frame(504), 96), 900);
});

test('gaps, stalled scrolls and unsafe canvas sizes are rejected', () => {
  assert.throws(() => framePlacement(frame(700), 1, 600), /gap/);
  assert.throws(() => framePlacement(frame(0), 1, 600), /new pixels/);
  assert.throws(() => checkedDimensions(1920, 30001), /safe canvas/);
  assert.throws(() => checkedDimensions(2000, 25000), /safe canvas/);
  assert.throws(() => checkedDimensions(NaN, 200), /safe canvas/);
  assert.deepEqual(checkedDimensions(1920, 8000), { width: 1920, height: 8000 });
});

test('frame comparison detects lazy growth and user movement', () => {
  assert.equal(sameFrame(frame(), frame()), true);
  assert.equal(sameFrame(frame(), frame(5)), false);
  assert.equal(sameFrame(frame(), frame(0, 1800)), false);
});

let commands;
let captures;
let current;
let drawCalls;
let closed;
let handlers;
beforeEach(() => {
  commands = [];
  captures = 0;
  drawCalls = [];
  closed = 0;
  current = frame(0, 600); // Single viewport keeps these error-path tests fast.
  const event = () => {
    const listeners = new Set();
    return { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn), listeners };
  };
  handlers = [event(), event()];
  globalThis.chrome = {
    tabs: {
      get: async () => ({ active: true, windowId: 3, url: 'https://example.netsuite.com/record', status: 'complete' }),
      onActivated: handlers[0], onUpdated: handlers[1],
      captureVisibleTab: async () => { captures++; return 'data:image/png;base64,eA=='; }
    },
    scripting: { executeScript: async (request) => {
      if (request.files) {
        assert.deepEqual(request.files, CONTENT_FILES);
        return [{ documentId: 'record-document' }];
      }
      assert.deepEqual(request.target.documentIds, ['record-document']);
      const command = request.args[0];
      commands.push(command.type);
      return [{ result: { ok: true, metrics: current } }];
    } }
  };
  globalThis.createImageBitmap = async () => ({ width: 800, height: 700, close: () => closed++ });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { fillRect() {}, drawImage: (...args) => drawCalls.push(args) }; }
    async convertToBlob() { return new Blob(['png-bytes'], { type: 'image/png' }); }
  };
});

const request = { tabId: 7, windowId: 3 };
test('full-page pipeline captures, crops, encodes and restores the same document', async () => {
  const progress = [];
  const result = await captureFullPage(request, { onProgress: (text) => progress.push(text) });
  assert.match(result, /^data:image\/png;base64,/);
  assert.equal(captures, 1);
  assert.equal(drawCalls[0][2], 80);
  assert.equal(closed, 1);
  assert.deepEqual(commands, ['begin', 'measure', 'scroll', 'restore']);
  assert.ok(progress.some((text) => /100%/.test(text)));
  assert.ok(handlers.every((event) => event.listeners.size === 0));
});

test('capture API failure always restores the original document', async () => {
  chrome.tabs.captureVisibleTab = async () => { throw new Error('Capture denied'); };
  await assert.rejects(captureFullPage(request), /Capture denied/);
  assert.equal(commands.at(-1), 'restore');
  assert.ok(handlers.every((event) => event.listeners.size === 0));
});

test('unsupported content reported at begin still triggers cleanup', async () => {
  const execute = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (request) => request.args?.[0].type === 'begin'
    ? [{ result: { ok: false, error: 'Virtualized table detected' } }]
    : execute(request);
  await assert.rejects(captureFullPage(request), /Virtualized/);
  assert.equal(commands.at(-1), 'restore');
  assert.equal(captures, 0);
});

test('cancellation after capture skips encoding and restores state', async () => {
  await assert.rejects(captureFullPage(request, { isCancelled: () => captures > 0 }), /cancelled/);
  assert.equal(commands.at(-1), 'restore');
  assert.equal(drawCalls.length, 0);
});

test('changes between measurement and screenshot abort rather than stitch stale pixels', async () => {
  chrome.tabs.captureVisibleTab = async () => { current = frame(12, 600); return 'data:image/png;base64,eA=='; };
  await assert.rejects(captureFullPage(request), /moved or changed/);
  assert.equal(commands.at(-1), 'restore');
});

test('failed restoration prevents a successful export', async () => {
  const execute = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (request) => {
    if (request.args?.[0].type === 'restore') throw new Error('Document closed');
    return execute(request);
  };
  await assert.rejects(captureFullPage(request), /restoration failed/);
  assert.ok(handlers.every((event) => event.listeners.size === 0));
});

test('late growth at the bottom extends the canvas and captures the new content', async () => {
  chrome.scripting.executeScript = async (request) => {
    if (request.files) return [{ documentId: 'record-document' }];
    const command = request.args[0];
    commands.push(command.type);
    if (command.type === 'scroll') current = frame(command.offset, 1000);
    return [{ result: { ok: true, metrics: current } }];
  };
  assert.match(await captureFullPage(request), /^data:image\/png;base64,/);
  assert.equal(captures, 2);
  // Initial frame, copy of the smaller canvas, then only the newly visible rows.
  assert.equal(drawCalls.length, 3);
  assert.equal(drawCalls[2].at(-1), 400);
  assert.equal(commands.at(-1), 'restore');
});

test('invalid configurable overlap is rejected before injection', async () => {
  await assert.rejects(captureFullPage({ ...request, overlap: 10 }), /Overlap/);
  assert.equal(commands.length, 0);
  assert.equal(captures, 0);
});

test('horizontal overflow produces one warning and allows the vertical PNG', async () => {
  current.warnings = ['Visible columns only: sideways content is not included.'];
  const warnings = [];
  assert.match(await captureFullPage(request, { onWarning: (warning) => warnings.push(warning) }), /^data:image\/png;base64,/);
  assert.deepEqual(warnings, current.warnings);
  assert.equal(captures, 1);
  assert.equal(commands.at(-1), 'restore');
});

test('manager forwards horizontal warnings and marks the downloaded PNG', async () => {
  current.warnings = ['Visible columns only: sideways content is not included.'];
  let download;
  chrome.downloads = { download: async (options) => { download = options; return 81; } };
  const result = await captureVisibleRecord({ ...request, mode: 'full', format: 'png' });
  assert.equal(result.downloadId, 81);
  assert.deepEqual(result.warnings, current.warnings);
  assert.match(download.filename, /-visible-columns\.png$/);
  assert.equal(commands.at(-1), 'restore');
});

test('all-columns orchestration captures horizontal tiles and restores the page', async () => {
  current = { ...current, totalWidth: 1000, horizontalOffset: 0 };
  const execute = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (request) => {
    if (request.args?.[0].type === 'scroll') {
      current = { ...current, horizontalOffset: request.args[0].left, offset: request.args[0].offset };
    }
    return execute(request);
  };
  assert.match(await captureFullPage({ ...request, horizontal: 'all' }), /^data:image\/png;base64,/);
  assert.equal(captures, 2);
  assert.equal(drawCalls.length, 2);
  assert.equal(drawCalls[1].at(-2), 200);
  assert.equal(commands.at(-1), 'restore');
});

test('unknown column choices are rejected before capture', async () => {
  await assert.rejects(captureFullPage({ ...request, horizontal: 'invalid' }), /Choose Visible columns/);
  assert.equal(captures, 0);
});
