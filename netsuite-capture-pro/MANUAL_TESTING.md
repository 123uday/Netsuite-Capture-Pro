# Manual acceptance checklist

All boxes start unchecked. Record Chrome version, OS, record type, browser zoom, device scale, result and any error. Use test records without modifying record data.

## Phase 1 — runnable now

- [ ] Load unpacked in Chrome; manifest, popup and worker show no errors.
- [ ] Short NetSuite record: capture PNG and compare visible pixels, proportions and resolution with the viewport.
- [ ] Long Item record: scroll midway, capture; verify only the current viewport is captured and scroll position stays unchanged.
- [ ] Customer, Vendor, Purchase Order, Vendor Bill and Invoice: repeat visible capture on each accessible record type.
- [ ] Visible nested sublist, sticky headers and iframe: confirm currently visible pixels appear as displayed, without claiming hidden content is included.
- [ ] PNG: accept save dialog, open image, verify filename and completed download in Chrome Downloads.
- [ ] Cancel save dialog; check error/Downloads status, then retry successfully.
- [ ] Rapid repeated clicks: verify only one request is processed at a time and controls recover.
- [ ] Switch active tabs or navigate during capture: verify stale captures are rejected when detected; retry on the intended record.
- [ ] Move OS focus to another window or DevTools during capture: verify focus changes alone do not reject capture and the PNG still belongs to the original selected tab/window.
- [ ] Try a browser internal page: verify a readable error and a successful retry on HTTP/HTTPS.
- [ ] Close popup during capture: verify the worker can request the download; reopen and retry.
- [ ] Full-page and Selected element capture are enabled; PDF and both-format options remain disabled.
- [ ] Check network activity/source: no screenshot uploads or external runtime dependencies.

## Phase 2 — runnable now; NetSuite acceptance pending

- [ ] Full-page short record: complete image, no duplicated overlap, state restored.
- [ ] Long Item record: document versus internal scroll detection, accurate offsets and overlap.
- [ ] Nested scrollable sublist: show an explicit unsupported-content error; export no incomplete image and restore original state.
- [ ] Sticky/fixed headers: avoid repeated header pixels without removing record content.
- [ ] Lazy loading/dynamic sections: wait for stable content; report unreliable capture.
- [ ] Virtualized long sublists: known virtualization must report a limitation. Verify all row numbers on apparently non-virtualized long tables before relying on coverage.
- [ ] Visible iframe: report the unsupported-content error and export no image.
- [ ] Hidden horizontal columns: vertical capture proceeds; the popup clearly reports **Visible columns only** and the downloaded filename ends with `-visible-columns.png`. Verify sideways content is not claimed as captured.
- [ ] Minor horizontal overflow (up to 8 CSS pixels) and navigation-only horizontal scroll regions do not block capture or trigger a hidden-columns warning.
- [ ] Choose **All columns** on a wide record: verify leftmost/rightmost columns, all horizontal seams and the final partial tile; no visible-columns warning should be reported for supported complete capture.
- [ ] Choose **All columns** on a horizontally scrolling sublist: compare every column against the record and verify the original sublist width and horizontal scroll position are restored.
- [ ] Check frozen/pinned columns in **All columns**: appear in the first horizontal tile without repetition in subsequent tiles or disappearing from later vertical strips.
- [ ] Cancel an all-columns capture after sideways scrolling: verify original inline styles, widths and both scroll coordinates return to their starting values.
- [ ] Known column virtualization, right-to-left roots or unexpandable clipped sublists: show an explicit limitation and restore layout; never silently fall back to visible columns.
- [ ] Cancellation/error during scrolling: use popup Cancel and page Escape; verify temporary styles/listeners and scroll positions are restored.
- [ ] Extremely long page: detect canvas/memory limits and report a clear error instead of a truncated file.
- [ ] Start midway through the record: capture begins at the top and restores the exact original position after success and cancellation.
- [ ] Reopen popup while running: progress and Cancel remain available; repeated starts are rejected.
- [ ] Resize or change zoom during capture: report the changed viewport and restore page state.
- [ ] Adjust overlap to 32, 96 and 300: inspect section boundaries and the final partial viewport for duplicate/missing rows.
- [ ] Full page + Visible columns at 125% browser/display scale: test an internal record container that reaches the viewport bottom; verify PNG export without crop errors or missing final rows.
- [ ] Long NetSuite Items sublist with a floating horizontal scrollbar: verify no repeated scrollbar bands or interrupted row text at any seam; compare rows across each former band against the record.
- [ ] Floating scrollbar appearing only after scrolling: verify the new control is suppressed before subsequent frames and restored when capture ends.
- [ ] After success, Escape, popup Cancel and capture failure: verify native scrollbars and floating controls return, and remain usable at the original scroll position.
- [ ] Test Item, Customer, Vendor, Purchase Order, Vendor Bill and Invoice records independently, including long sublists.

## Automated evidence

`npm.cmd test` covers orchestration, messaging, cancellation, target changes, overlap math, dimension limits and cleanup using mocked Chrome APIs. `npm.cmd run test:browser` uses real headless Chrome on local fixtures to check document/internal scrolling, sticky headers, lazy growth, pixel colors, PNG encoding, restored scrolling/styles, unsupported-content detection and Escape cancellation. These do not replace authenticated NetSuite acceptance above.

## Phase 3 — runnable now; authenticated NetSuite acceptance pending

- [ ] Primary Information and Summary: select each; confirm the PNG contains only that selected content box.
- [ ] Hover a small field, use Arrow Up/Down to choose an appropriate section, then confirm with Enter or click.
- [ ] Items sublist with a native vertical scroll area: capture all rendered rows and restore its original position.
- [ ] Select a section containing multiple nested scrolling levels: verify every row, original heights and all original scroll offsets.
- [ ] Select a tall section inside another scrolling panel: verify cropping follows the selected section and includes its bottom.
- [ ] Visible columns versus All columns: verify the warning/filename for excluded columns and full rendered column coverage in All columns.
- [ ] Click a record action while the selector is active: it must select the outlined section without activating that action. Perform this only in a sandbox/test record.
- [ ] Escape before selection: remove outline/listeners; retry successfully.
- [ ] Escape or popup Cancel after scrolling begins: restore page, nested scrolling, styles and controls; export no partial file.
- [ ] Reopen the popup during selection/capture: see progress and Cancel without starting another capture.
- [ ] Virtualized sublist, iframe and unsupported clipping/transform: show an explicit limitation, clean up, export nothing.
- [ ] Browser zoom/display scaling at 125%: inspect crop edges and both-axis seams.
- [ ] Repeat visible/full-page capture after element success and cancellation to verify Phase 1/2 behavior.

## Later phases — blocked until implemented

- [ ] Multi-page A4 PDF: preserve aspect ratio, page order and all content.
- [ ] PNG + PDF: both downloads succeed and open.
