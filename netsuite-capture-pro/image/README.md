`image-stitcher.js` uses native OffscreenCanvas inside the service worker, measures screenshot scale, crops the detected scroll root, discards duplicate overlap and copies only new pixel rows. Frames are decoded and closed individually. A growing record can grow the canvas within conservative size limits; shrinkage, gaps and context loss stop capture. `convertToBlob()` encodes PNG in the worker. Its source and `grid-stitcher.js` are unchanged by Phase 3.

`grid-stitcher.js` extends the same PNG encoding and resource cleanup for **All columns**. Horizontal tiles are consumed left-to-right for each vertical strip; both axes use actual measured offsets and discard overlapping pixels. Every strip must reach the right edge before the next strip can begin or the image can be exported. Width changes and incomplete strips abort export.

Visible-column source crops retain fractional screenshot coordinates and use the actual bitmap's horizontal and vertical scales. Destination rows remain contiguous integers. This avoids a one-pixel out-of-bounds crop when independently rounding a fractional origin and height at browser/display scaling such as 125%. Materially out-of-view containers still fail explicitly.

All-column tiles independently apply fractional source-edge mapping on both axes, including screenshot height rounding. Destination edges and overlap accounting remain integer-based. This correction is confined to `grid-stitcher.js`; the working visible-column capture and its scrollbar cleanup are not changed.

Phase 3 adds `image-cropper.js`, which validates selected-element crop rectangles and delegates selected tiles to the existing grid compositor without changing its source.
