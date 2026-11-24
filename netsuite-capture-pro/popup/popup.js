const form = document.querySelector('#capture-form');
const button = document.querySelector('#capture');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
document.querySelector('#version').textContent = `Version ${chrome.runtime.getManifest().version}`;
let submitting = false;
form.elements.mode.addEventListener('change', () => {
  const elementMode = form.elements.mode.value === 'element';
  document.querySelector('#element-help').hidden = !elementMode;
  document.querySelector('#columns-label').textContent = elementMode ? 'Selected-element columns' : 'Full-page columns';
  document.querySelector('#overlap-label').textContent = elementMode ? 'Selected-element overlap (pixels)' : 'Full-page overlap (pixels)';
});

function render(state) {
  button.disabled = state.running;
  cancel.hidden = !state.running;
  progress.hidden = !state.running;
  status.dataset.error = String(Boolean(state.error));
  status.dataset.warning = String(Boolean(state.warnings?.length));
  status.textContent = [state.text, ...(state.warnings || [])].join(' ');
}

async function refresh() {
  if (submitting) return;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE_STATUS' });
    if (state && typeof state.running === 'boolean') render(state);
  } catch (error) {
    render({ running: false, error: true, text: error.message });
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  submitting = true;
  render({ running: true, text: 'Preparing capture…' });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
      throw new Error('No active tab found. Open a NetSuite record and retry.');
    }
    const pending = chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      tabId: tab.id,
      windowId: tab.windowId,
      mode: form.elements.mode.value,
      format: form.elements.format.value,
      horizontal: form.elements.horizontal.value,
      overlap: Number(form.elements.overlap.value)
    });
    const unlock = setTimeout(() => { submitting = false; }, 300);
    let response;
    try { response = await pending; } finally { clearTimeout(unlock); }
    if (!response?.ok) throw new Error(response?.error || 'The capture worker did not respond.');
    render({ running: false, text: 'PNG download requested. Check Chrome Downloads for completion.', warnings: response.warnings });
  } catch (error) {
    render({ running: false, error: true, text: error instanceof Error ? error.message : 'Capture failed. Please retry.' });
  } finally {
    submitting = false;
  }
});

cancel.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_CAPTURE' });
    await refresh();
  } catch (error) {
    render({ running: false, error: true, text: error.message });
  }
});

void refresh();
const poll = setInterval(refresh, 1000);
window.addEventListener('pagehide', () => clearInterval(poll), { once: true });
