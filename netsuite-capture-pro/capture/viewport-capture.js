export async function validateTarget(tabId, windowId, expectedUrl) {
  const tab = await chrome.tabs.get(tabId);
  // OS focus can move to the extension popup or DevTools. Capture targets the
  // explicit window ID; only the active tab inside that window must match.
  if (!tab.active || tab.windowId !== windowId) {
    throw new Error('The selected tab is no longer active in its original window. Return to the record and retry.');
  }
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error('Open an HTTP or HTTPS NetSuite record before capturing.');
  }
  if (tab.status !== 'complete' || tab.pendingUrl) {
    throw new Error('Wait for the page to finish loading, then retry.');
  }
  if (expectedUrl && tab.url !== expectedUrl) {
    throw new Error('The page changed during capture. Retry on the intended record.');
  }
  return tab;
}

export async function captureViewport(tabId, windowId) {
  const tab = await validateTarget(tabId, windowId);
  let targetChanged = false;
  const onActivated = (info) => {
    if (info.windowId === windowId && info.tabId !== tabId) targetChanged = true;
  };
  const onUpdated = (id, change) => {
    if (id === tabId && (change.url || change.status === 'loading')) targetChanged = true;
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  try {
    // captureVisibleTab targets a window's active tab, so check on both sides.
    await validateTarget(tabId, windowId, tab.url);
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    await validateTarget(tabId, windowId, tab.url);
    if (targetChanged) throw new Error('The active tab or page changed. Capture discarded; retry.');
    if (!dataUrl?.startsWith('data:image/png;base64,')) {
      throw new Error('Chrome did not return a valid PNG screenshot.');
    }
    return dataUrl;
  } finally {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }
}
