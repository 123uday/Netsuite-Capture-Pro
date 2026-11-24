import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureVisibleRecord } from '../capture/capture-manager.js';
import { exportPng } from '../export/png-exporter.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const request = { type: 'CAPTURE_VISIBLE', tabId: 7, windowId: 3, mode: 'visible', format: 'png' };
let tab;
let downloads;
let events;
function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args))
  };
}
beforeEach(() => {
  tab = { id: 7, windowId: 3, active: true, status: 'complete', url: 'https://example.netsuite.com/app/accounting/item.nl?id=1' };
  downloads = [];
  events = [event(), event(), event()];
  globalThis.chrome = {
    tabs: {
      get: async () => ({ ...tab }),
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, 3);
        assert.deepEqual(options, { format: 'png' });
        return png;
      },
      onActivated: events[0], onUpdated: events[1]
    },
    windows: { get: async () => ({ focused: true }), onFocusChanged: events[2] },
    downloads: { download: async (options) => { downloads.push(options); return 42; } }
  };
});

test('visible capture uses the intended window and downloads a local PNG', async () => {
  assert.deepEqual(await captureVisibleRecord(request), { downloadId: 42 });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, png);
  assert.match(downloads[0].filename, /^NetSuite-Capture-.*\.png$/);
  assert.equal(downloads[0].saveAs, true);
  assert.ok(events.every((entry) => entry.listeners.size === 0));
});

test('exports with hidden horizontal content are identified in the filename', async () => {
  await exportPng(png, { visibleColumnsOnly: true });
  assert.match(downloads[0].filename, /-visible-columns\.png$/);
});

test('invalid requests and unsupported modes never capture or download', async () => {
  chrome.tabs.captureVisibleTab = () => assert.fail('Unexpected capture');
  for (const changes of [{ tabId: -1 }, { windowId: '3' }, { mode: 'element' }, { format: 'pdf' }]) {
    await assert.rejects(captureVisibleRecord({ ...request, ...changes }), /Invalid capture request/);
  }
  assert.equal(downloads.length, 0);
});

test('inactive, loading, restricted and moved targets are rejected', async () => {
  chrome.tabs.captureVisibleTab = () => assert.fail('Unexpected capture');
  for (const changes of [{ active: false }, { status: 'loading' }, { url: 'chrome://extensions/' }, { windowId: 4 }]) {
    const original = { ...tab };
    Object.assign(tab, changes);
    await assert.rejects(captureVisibleRecord(request));
    tab = original;
  }
  assert.equal(downloads.length, 0);
});

test('an unfocused Chrome window still captures its explicitly selected active tab', async () => {
  chrome.windows.get = async () => ({ focused: false });
  assert.deepEqual(await captureVisibleRecord(request), { downloadId: 42 });
  assert.equal(downloads.length, 1);
});

test('temporary OS focus changes during capture do not discard the intended tab', async () => {
  chrome.tabs.captureVisibleTab = async (windowId) => {
    assert.equal(windowId, 3);
    events[2].emit(-1);
    events[2].emit(9);
    events[2].emit(3);
    return png;
  };
  assert.deepEqual(await captureVisibleRecord(request), { downloadId: 42 });
  assert.equal(downloads.length, 1);
  assert.ok(events.every((entry) => entry.listeners.size === 0));
});

test('switching away and back while capturing discards the screenshot', async () => {
  chrome.tabs.captureVisibleTab = async () => {
    events[0].emit({ windowId: 3, tabId: 8 });
    events[0].emit({ windowId: 3, tabId: 7 });
    return png;
  };
  await assert.rejects(captureVisibleRecord(request), /discarded/);
  assert.equal(downloads.length, 0);
  assert.ok(events.every((entry) => entry.listeners.size === 0));
});

test('navigation during capture discards the screenshot', async () => {
  chrome.tabs.captureVisibleTab = async () => { tab.url += '&changed=1'; return png; };
  await assert.rejects(captureVisibleRecord(request), /page changed/);
  assert.equal(downloads.length, 0);
  assert.ok(events.every((entry) => entry.listeners.size === 0));
});

test('Chrome API failures propagate and listeners are removed', async () => {
  chrome.tabs.captureVisibleTab = async () => { throw new Error('Capture quota exceeded'); };
  await assert.rejects(captureVisibleRecord(request), /quota exceeded/);
  assert.ok(events.every((entry) => entry.listeners.size === 0));
  chrome.tabs.captureVisibleTab = async () => png;
  chrome.downloads.download = async () => { throw new Error('Download canceled'); };
  await assert.rejects(captureVisibleRecord(request), /Download canceled/);
});

test('worker rejects untrusted callers and releases its lock after failure', async () => {
  const messages = event();
  chrome.runtime = { id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}`, onMessage: messages };
  await import('../background/service-worker.js');
  const [listener] = messages.listeners;
  const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/popup.html') };
  assert.equal(listener(request, { ...sender, tab: { id: 7 } }, () => assert.fail()), false);
  assert.equal(listener(request, { ...sender, id: 'other-extension' }, () => assert.fail()), false);
  assert.equal(listener(request, { ...sender, url: 'https://example.com' }, () => assert.fail()), false);
  assert.equal(listener({ type: 'UNKNOWN' }, sender, () => assert.fail()), false);
  let finishCapture;
  chrome.tabs.captureVisibleTab = () => new Promise((resolve) => { finishCapture = resolve; });
  const first = new Promise((resolve) => assert.equal(listener(request, sender, resolve), true));
  const busy = await new Promise((resolve) => listener(request, sender, resolve));
  assert.match(busy.error, /already in progress/);
  // Let target validation resolve before completing the pending screenshot.
  await new Promise((resolve) => setImmediate(resolve));
  finishCapture(png);
  assert.equal((await first).ok, true);
  const complete = await new Promise((resolve) => listener({ type: 'GET_CAPTURE_STATUS' }, sender, resolve));
  assert.equal(complete.running, false);
  assert.match(complete.text, /download requested/);
  const invalid = await new Promise((resolve) => listener({ ...request, mode: 'element' }, sender, resolve));
  assert.equal(invalid.ok, false);
  chrome.tabs.captureVisibleTab = async () => png;
  const retry = await new Promise((resolve) => listener(request, sender, resolve));
  assert.equal(retry.ok, true);
  const downloadCount = downloads.length;
  chrome.tabs.captureVisibleTab = () => new Promise((resolve) => { finishCapture = resolve; });
  const cancelPending = new Promise((resolve) => listener(request, sender, resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => listener({ type: 'CANCEL_CAPTURE' }, sender, resolve));
  finishCapture(png);
  assert.match((await cancelPending).error, /cancelled/);
  assert.equal(downloads.length, downloadCount);
});
