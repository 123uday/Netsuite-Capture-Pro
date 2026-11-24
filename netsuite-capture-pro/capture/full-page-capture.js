import { captureViewport, validateTarget } from './viewport-capture.js';
import { ImageStitcher, checkedDimensions } from '../image/image-stitcher.js';
import { GridStitcher } from '../image/grid-stitcher.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const CONTENT_FILES = ['content/scroll-detector.js', 'content/scrollbar-cleanup.js', 'content/content.js'];

export function nextOffset(metrics, overlap) {
  return Math.min(metrics.totalHeight - metrics.clip.height,
    metrics.offset + Math.max(1, metrics.clip.height - overlap));
}

export function sameFrame(before, after) {
  return Math.abs(before.offset - after.offset) < 0.5 &&
    before.totalHeight === after.totalHeight && before.dpr === after.dpr &&
    before.horizontalOffset === after.horizontalOffset && before.totalWidth === after.totalWidth &&
    before.viewportWidth === after.viewportWidth && before.viewportHeight === after.viewportHeight &&
    ['x', 'y', 'width', 'height'].every((key) => Math.abs(before.clip[key] - after.clip[key]) < 0.5);
}

export async function captureFullPage(message, { onProgress = () => {}, onWarning = () => {}, isCancelled = () => false } = {}) {
  const { tabId, windowId } = message;
  const overlap = message.overlap ?? 96;
  const horizontal = message.horizontal ?? 'visible';
  if (!['visible', 'all'].includes(horizontal)) throw new Error('Choose Visible columns or All columns.');
  if (!Number.isInteger(overlap) || overlap < 32 || overlap > 300) throw new Error('Overlap must be between 32 and 300 CSS pixels.');
  const tab = await validateTarget(tabId, windowId);
  const token = crypto.randomUUID();
  const stitcher = horizontal === 'all' ? new GridStitcher() : new ImageStitcher();
  let documentId;
  const started = Date.now();
  let targetChanged = false;
  const onActivated = (info) => { if (info.windowId === windowId && info.tabId !== tabId) targetChanged = true; };
  const onUpdated = (id, change) => { if (id === tabId && (change.url || change.status === 'loading')) targetChanged = true; };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  const assertRunning = () => {
    if (targetChanged) throw new Error('The selected tab or page changed during full-page capture. Retry on the intended record.');
    if (isCancelled()) throw new Error('Capture cancelled. Original page state was restored.');
    if (Date.now() - started > 480000) throw new Error('Capture exceeded eight minutes. Try a shorter record.');
  };
  const command = async (type, extras = {}) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      func: (request) => globalThis.__netSuiteCapturePro.command(request),
      args: [{ type, token, ...extras }]
    });
    const result = results[0]?.result;
    if (!result?.ok) throw new Error(result?.error || 'The record content script did not respond.');
    return result.metrics;
  };
  let originalError;
  try {
    onProgress('Detecting the record scroll container…');
    const injected = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });
    documentId = injected[0]?.documentId;
    if (!documentId) throw new Error('Chrome did not identify the target document. Update Chrome and retry.');
    await validateTarget(tabId, windowId, tab.url);
    assertRunning();
    let metrics = await command('begin', { horizontal });
    const original = metrics;
    let horizontalWarningReported = false;
    const effectiveOverlap = Math.min(overlap, Math.floor(metrics.clip.height / 3));
    for (let frame = 0; frame < 500; frame++) {
      if (!horizontalWarningReported && metrics.warnings?.length) {
        horizontalWarningReported = true;
        onWarning(metrics.warnings[0]);
      }
      assertRunning();
      await validateTarget(tabId, windowId, tab.url);
      checkedDimensions(Math.round((horizontal === 'all' ? metrics.totalWidth : metrics.clip.width) * metrics.dpr), Math.round(metrics.totalHeight * metrics.dpr));
      if (horizontal === 'all' && metrics.totalWidth !== original.totalWidth) throw new Error('The record width changed. Wait for loading to finish and retry All columns.');
      if (metrics.clip.width !== original.clip.width || metrics.clip.height !== original.clip.height ||
          metrics.clip.x !== original.clip.x || metrics.clip.y !== original.clip.y) {
        throw new Error('The scrolling container moved or resized. Retry when the layout is stable.');
      }
      const pixels = await captureViewport(tabId, windowId);
      const after = await command('measure');
      if (!horizontalWarningReported && after.warnings?.length) {
        horizontalWarningReported = true;
        onWarning(after.warnings[0]);
      }
      if (!sameFrame(metrics, after)) throw new Error('The record moved or changed while taking a screenshot. Retry when it is stable.');
      assertRunning();
      await stitcher.append(pixels, metrics);
      const columnProgress = horizontal === 'all' ? Math.min(1, (metrics.horizontalOffset + metrics.clip.width) / metrics.totalWidth) : 1;
      onProgress(`Captured tile ${frame + 1} · ${Math.min(100, Math.round((metrics.offset + metrics.clip.height * columnProgress) / metrics.totalHeight * 100))}% (${metrics.kind}). Escape on the page cancels.`);
      if (horizontal === 'all' && metrics.horizontalOffset + metrics.clip.width < metrics.totalWidth - 0.5) {
        const left = Math.min(metrics.totalWidth - metrics.clip.width,
          metrics.horizontalOffset + Math.max(1, metrics.clip.width - effectiveOverlap));
        await pause(550);
        assertRunning();
        const previous = metrics;
        metrics = await command('scroll', { offset: metrics.offset, left, hideHeaders: metrics.offset > 0 });
        if (metrics.horizontalOffset <= previous.horizontalOffset + 0.5 || metrics.offset !== previous.offset || metrics.totalHeight !== previous.totalHeight) {
          throw new Error('The record did not scroll horizontally without changing its layout.');
        }
        continue;
      }
      if (metrics.offset + metrics.clip.height >= metrics.totalHeight - 0.5) {
        // One final settle catches delayed growth at the bottom before exporting.
        const finalMetrics = await command('scroll', { offset: metrics.offset, left: metrics.horizontalOffset || 0, hideHeaders: metrics.offset > 0 });
        if (!horizontalWarningReported && finalMetrics.warnings?.length) {
          horizontalWarningReported = true;
          onWarning(finalMetrics.warnings[0]);
        }
        if (sameFrame(metrics, finalMetrics)) {
          assertRunning();
          onProgress('Encoding full-page PNG…');
          return await stitcher.toPng();
        }
        if (finalMetrics.totalHeight <= metrics.totalHeight) throw new Error('The record changed at the end of capture. Retry when it is stable.');
        metrics = finalMetrics;
      }
      const offset = nextOffset(metrics, effectiveOverlap);
      if (offset <= metrics.offset + 0.5) throw new Error('The record stopped scrolling before all content was captured.');
      // Chrome permits at most two visible captures per second. Render settling
      // also takes >=650 ms, but this explicit interval keeps pacing predictable.
      await pause(550);
      assertRunning();
      const previous = metrics;
      metrics = await command('scroll', { offset, left: 0, hideHeaders: true });
      if (metrics.offset <= previous.offset + 0.5 || metrics.totalHeight < previous.totalHeight) {
        throw new Error('The record did not advance reliably while scrolling.');
      }
    }
    throw new Error('The record exceeds the capture section limit (500).');
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    try {
      if (documentId) await command('restore');
    } catch (error) {
      // If the document navigated away there is no original DOM left to restore.
      // A watchdog also restores the page if the service worker is interrupted.
      if (!originalError) throw new Error(`Capture finished but page restoration failed: ${error.message}`);
    } finally {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      stitcher.dispose();
    }
  }
}
