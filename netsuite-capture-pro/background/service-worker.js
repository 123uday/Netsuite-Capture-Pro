import { captureVisibleRecord } from '../capture/capture-manager.js';
import { captureElementRecord } from '../capture/element-capture.js';

let captureInProgress = false;
let cancelled = false;
let status = { running: false, text: 'Ready. Open the record you want to capture.', error: false };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our popup can initiate capture; content scripts are not trusted callers.
  if (sender.id !== chrome.runtime.id || sender.tab ||
      sender.url !== chrome.runtime.getURL('popup/popup.html')) {
    return false;
  }
  if (message?.type === 'GET_CAPTURE_STATUS') {
    sendResponse(status);
    return false;
  }
  if (message?.type === 'CANCEL_CAPTURE') {
    if (captureInProgress) {
      cancelled = true;
      status = { running: true, text: 'Cancelling and restoring the record…', error: false };
    }
    sendResponse({ ok: true });
    return false;
  }
  if (!['CAPTURE_VISIBLE', 'START_CAPTURE'].includes(message?.type)) return false;

  if (captureInProgress) {
    sendResponse({ ok: false, error: 'A capture is already in progress.' });
    return false;
  }

  captureInProgress = true;
  cancelled = false;
  status = { running: true, text: 'Preparing capture…', error: false };
  (async () => {
    try {
      const capture = message.mode === 'element' ? captureElementRecord : captureVisibleRecord;
      const result = await capture(message, {
        isCancelled: () => cancelled,
        onProgress: (text) => { if (!cancelled) status = { ...status, running: true, text, error: false }; },
        onWarning: (warning) => { status = { ...status, warnings: [warning] }; }
      });
      status = { running: false, text: 'PNG download requested. Check Chrome Downloads for completion.', error: false, warnings: result.warnings || [] };
      sendResponse({ ok: true, ...result });
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Capture failed.';
      status = { running: false, text, error: true };
      sendResponse({ ok: false, error: text });
    } finally {
      captureInProgress = false;
    }
  })();
  return true;
});
