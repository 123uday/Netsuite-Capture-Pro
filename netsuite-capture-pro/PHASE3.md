# Selected element capture

Version 0.4.0 adds Phase 3 as a separate path. The existing viewport/full-page capture manager, scroll controllers, stitchers and PNG exporter are used without source changes. Shared integration adds one worker dispatch branch and enables the popup's element option. No additional permissions or dependencies are required.

## Use in Chrome

1. Reload the extension at `chrome://extensions` and refresh the NetSuite record. Confirm **Version 0.4.0** in the popup.
2. Choose **Selected element**, **Visible columns** or **All columns**, and **PNG**. Click **Capture PNG**.
3. Move the pointer over the record. A blue outline shows the current section. Scroll the page during selection if needed.
4. Use **Arrow Up** to select the parent section or **Arrow Down** for its first visible child. Click or press **Enter** to confirm; **Escape** cancels.
5. Let the extension capture. The popup may close when the record is clicked; capture continues in the worker. Reopen it for progress and Cancel, or press Escape on the record.
6. Save and inspect the PNG. It contains the selected content box, excluding borders and scrollbar tracks, rather than the surrounding record. Verify the original scrolling and layout have returned.

Pointing at a scrollable sublist prioritizes that scroll container. Otherwise tables, sections, field groups and then individual elements are candidates. Selection clicks are intercepted so record buttons are not activated. Iframe overlays intercept clicks while selecting; iframe content itself is rejected with a limitation.

## Implementation

- `content/element-selector.js`: isolated-world pointer/keyboard selection, shadow overlay, timeout and listener cleanup.
- `content/element-content.js`: session-scoped commands, viewport intersections, selected/ancestor scrolling, nested scroller expansion, rendering waits and restoration. It uses its own namespace and temporary styles, separate from Phase 2.
- `capture/element-capture.js`: document-bound orchestration, paced capture, validated targets, progress/cancellation, complete strip checks, and PNG download only after successful restoration.
- `image/image-cropper.js`: validates the selected rectangle and crops each tile before passing it to the existing grid compositor. The existing compositor source is unchanged.

The controller scrolls the selection itself when applicable and scrolls its ancestors/page when a tall selection extends beyond the viewport. Nested vertical scroll regions inside the selected section are temporarily expanded; All columns also expands horizontal regions. Styles, inline property priorities, nested/ancestor/window scroll positions, overlays, observers and listeners are restored in cleanup. A 20-second watchdog handles worker interruption; selection times out after two minutes.

## Limits

- Capture includes currently rendered/expanded content. It does not open other tabs, expand collapsed record sections or trigger record actions.
- Known virtualization, changing/replaced rows, visible iframes, transformed ancestors, pinch zoom, right-to-left sections and nested containers that cannot expand reliably produce errors rather than incomplete exports. Unknown virtualization cannot be universally detected; verify row counts on long sublists.
- Expanding a nested scroller may change wrapping/row heights in the temporary layout. Its original dimensions and scrolling are restored afterward.
- Visible columns reports excluded sideways content and marks the PNG filename accordingly. All columns requires stable total width and includes all supported rendered columns.
- Changing layout, continuous loading, resize/zoom changes or screenshot-time movement abort capture. Very late loading cannot be ruled out automatically.
- The existing canvas/PNG limits apply, plus 500 tiles and eight minutes including selection. PDF remains Phase 4 work.

## Verification

```powershell
npm.cmd run build
npm.cmd run validate
npm.cmd test
npm.cmd run test:element-browser
```

The element browser suite uses a separate headless Chrome profile on local fixtures at 125% display scale. It checks small/tall sections, selected scrollers, deep nested scrolling, external clipping ancestors, all-column cropping, cancellation, unsupported content, record-button click interception, and restoration. It uses the same temporary-profile/no-sandbox test harness strategy documented in README; actual extension APIs are mocked in unit tests. Browser fixtures do not replace authenticated NetSuite acceptance. Individual cases can be run with e.g. `npm.cmd run test:element-browser -- nested-deep actions`.
