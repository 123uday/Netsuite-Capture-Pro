import { captureViewport } from './viewport-capture.js';
import { exportPng } from '../export/png-exporter.js';
import { captureFullPage } from './full-page-capture.js';

export async function captureVisibleRecord(message, controls = {}) {
  if (!Number.isInteger(message.tabId) || message.tabId < 0 ||
      !Number.isInteger(message.windowId) || message.windowId < 0 ||
      !['visible', 'full'].includes(message.mode) || message.format !== 'png') {
    throw new Error('Invalid capture request. Choose visible or full-page capture as PNG.');
  }
  if (message.horizontal !== undefined && !['visible', 'all'].includes(message.horizontal)) throw new Error('Invalid column capture option.');
  const warnings = [];
  const dataUrl = message.mode === 'full'
    ? await captureFullPage(message, {
      ...controls,
      onWarning: (warning) => {
        if (!warnings.includes(warning)) warnings.push(warning);
        controls.onWarning?.(warning);
      }
    })
    : await captureViewport(message.tabId, message.windowId);
  if (controls.isCancelled?.()) throw new Error('Capture cancelled. No image was exported.');
  const downloadId = await exportPng(dataUrl, { visibleColumnsOnly: warnings.length > 0 });
  return warnings.length ? { downloadId, warnings } : { downloadId };
}
