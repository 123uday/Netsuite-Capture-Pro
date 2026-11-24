# NetSuite Capture Pro

Full-page capture supports **Visible columns** and **All columns**, alongside the working visible screenshot. Phase 3 adds a separate **Selected element** capture path with interactive selection, cropped content, nested scrolling and page restoration; see [PHASE3.md](PHASE3.md). Existing Phase 1/2 capture implementations are unchanged. PDF export remains disabled and unimplemented.

## Audit

The supplied workspace (`C:\extensions`) contained no project files, including hidden files. There was no manifest, package.json, implementation, Git repository, or project instruction file to preserve. Consequently manifest paths, imports, Chrome API calls and communication could not be checked against an existing implementation. This is a new Phase 1 foundation.

## Run

Requires Chrome 116+ and Node.js 22+ for development checks; the extension has no npm dependencies or runtime build step.

```powershell
cd C:\extensions\netsuite-capture-pro
npm.cmd run build
npm.cmd run validate
npm.cmd test
npm.cmd run test:browser
```

`build` validates the directly loadable source tree; it does not generate a dist directory. Native ES modules work in the popup and module service worker. There are no classic content scripts using ES imports.

1. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
2. Select **Load unpacked** and choose `C:\extensions\netsuite-capture-pro` (the folder containing manifest.json).
3. Open a fully loaded HTTP/HTTPS NetSuite record. Pin the extension if useful.
4. Open the extension, choose **Visible screenshot** or **Full page**, leave **PNG** selected, and click **Capture PNG**. For Full page, choose **Visible columns** (current width) or **All columns (scroll and stitch)**. Full page uses a configurable 96 CSS pixel overlap (32–300, reduced for small viewports).
5. For full page, let the extension scroll without manually scrolling or switching tabs. The popup shows progress and can be reopened during capture. **Cancel capture** in the popup or Escape on the record stops capture. Choose a save location, open the image, and check Chrome Downloads for completion. Confirm the original scroll position is restored.
6. Inspect the extension's service worker from `chrome://extensions` if an error occurs. Reload the extension after changing source files.

## Architecture

- `popup/` supplies choices, busy state, and accessible success/error messages.
- `background/service-worker.js` accepts requests only from this extension's popup, serializes capture, and returns asynchronous errors.
- `capture/capture-manager.js` validates the requested mode, format and target IDs and coordinates capture/export.
- `capture/viewport-capture.js` checks the intended tab/window before and after capture, detects tab changes/navigation, and always removes its temporary listeners.
- `capture/full-page-capture.js` injects ordered classic scripts, binds every command to the original document ID, paces captures, validates frame measurements and restores the page in a finally block.
- `content/scroll-detector.js` and `content/content.js` find the scroll root, wait for rendering, suppress pinned headers after their first appearance and bottom overlays from the start, and restore temporary styles and scroll positions. A 20-second content watchdog restores state if the worker stops responding.
- `content/scrollbar-cleanup.js` hides native tracks and thin floating scrollbar widgets for capture, including absolute-positioned bars that follow scrolling. Cleanup restores their visibility and geometry. This avoids stitching a floating scrollbar into multiple positions across a long sublist.
- `image/image-stitcher.js` streams frames into a local OffscreenCanvas and crops a detected internal root to its content viewport. It rounds measured offsets at screenshot scale and discards overlapping pixel rows, including the final clamped scroll.
- `export/png-exporter.js` downloads native or stitched PNG using a generic timestamped filename. No record title or identifiers enter the filename.
- `assets/icons/` is reserved for optional icons. Phase 3's separate selector, controller, capture orchestration and cropper are described in [PHASE3.md](PHASE3.md).

Permissions are `activeTab`, `downloads` and `scripting`; the new scripting permission is required for scroll control. There are no host permissions, external connections, screenshot services, storage, remote scripts, jsPDF or esbuild dependencies. Canvas processing uses the worker-native OffscreenCanvas Blob API (`convertToBlob`) because a service worker has no HTML document; no additional offscreen-document permission is needed.

## Limits and verification

Full page captures currently rendered, expanded sections within one vertical scrolling root. Open the desired sections first. It never clicks record actions, expands tabs, or modifies record fields. An internal-root capture includes that record container rather than repeating the surrounding static navigation. Known virtualized grids, row removal during scrolling, independent nested scrollers and visible iframes stop capture with an explicit error. Unknown virtualization cannot be identified universally; verify long sublist row coverage against the record. Content revealed only through other tabs or collapsed sections is outside this phase.

**Visible columns** captures the current page width and reports a persistent **Visible columns only** warning in the popup if sideways content is excluded, including after reopening it while the worker is alive. The PNG filename ends in `-visible-columns.png` when this limitation is detected. Small overflow of up to eight CSS pixels and navigation-only scroll regions are ignored by the horizontal warning check.

**All columns** captures horizontal tiles left-to-right for each vertical strip, removes overlap on both axes and restores both scroll coordinates. Horizontally scrolling sublists and their ancestors inside the record are temporarily widened so their columns can be revealed by the outer scroll root. Original inline values/priorities, widths and scrolling are restored in cleanup, including on Escape. Temporary widening may change text wrapping and row heights compared with the original viewport. Sublist expansion that leaves clipped columns, right-to-left roots, detected column virtualization and width changes during capture produce explicit errors. This mode takes more time and memory; the existing canvas, PNG size and capture limits still apply. It cannot retrieve rows or columns absent from the DOM or capture independent nested vertical scrolling.

Lazy growth is remeasured after scrolling and at the bottom. Continuously changing content, unsupported clipping/transforms, resizing/zoom changes, stalled scrolling and shrinking layouts stop capture. A settling window cannot prove that a site will never append content later. Sticky suppression is best effort; complex positioned headers should be checked manually. Limits are 30,000 output pixels per side, 40 megapixels, 64 MB encoded PNG, 500 frames and eight minutes. Browser resource failures can still occur below these conservative limits. Frames and canvases are released after capture.

Chrome download acceptance is reported as a request, not proof of completed disk write. Check Chrome Downloads for completion/cancellation. Worker progress is held in memory and is available when reopening the popup while the worker remains alive. OS focus is not required; the original window ID and active tab are checked. Chrome provides no atomic capture-by-tab API. HTTP/HTTPS pages are allowed rather than guessing account domains; browser internal pages and file URLs are rejected.

`npm.cmd test` exercises capture orchestration, target checks, two-dimensional overlap, incomplete strips, size limits, cancellation and cleanup with Chrome API mocks. `npm.cmd run test:browser` starts a separate temporary headless Chrome profile and tests real DOM scrolling and Canvas pixels on loopback-only fixtures at 1.25 device scale: document/internal scrolling, wide documents/internal roots/sublists, pinned columns, sticky headers, lazy growth, unsupported nested/virtualized/iframe content, horizontal warnings and Escape restoration. It does not load the extension or exercise actual `chrome.tabs.captureVisibleTab` or Downloads. The fixture browser runs with `--no-sandbox` for compatibility with the restricted development environment; this flag is not part of extension operation. Set `CHROME_PATH` to override the Windows Chrome executable path. Individual fixtures can be selected, for example `npm.cmd run test:browser -- wide-sublist wide-cancel`.

Phase 1 visible capture has been verified by the user's Purchase Order screenshot. Phase 2 authenticated NetSuite acceptance remains manual; use `MANUAL_TESTING.md`.
