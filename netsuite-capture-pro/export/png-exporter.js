export async function exportPng(dataUrl, { visibleColumnsOnly = false } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Cannot export an invalid PNG.');
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Both native viewport PNGs and locally stitched PNGs use the same download
  // path. Data URLs avoid needing an offscreen document to own a Blob URL.
  return chrome.downloads.download({
    url: dataUrl,
    filename: `NetSuite-Capture-${timestamp}${visibleColumnsOnly ? '-visible-columns' : ''}.png`,
    saveAs: true,
    conflictAction: 'uniquify'
  });
}
