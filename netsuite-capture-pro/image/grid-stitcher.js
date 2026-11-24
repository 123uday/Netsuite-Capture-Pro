import { ImageStitcher, checkedDimensions, framePlacement } from './image-stitcher.js';

function sourceAxis(origin, span, offset, outputScale, sourceScale, placement, limit) {
  const frameStart = Math.round(offset * outputScale);
  const frameSize = Math.round((offset + span) * outputScale) - frameStart;
  if (frameSize < 1) throw new Error('The horizontal tile has no pixel area.');
  // Keep source edges fractional; only destination tile edges are integers.
  // An origin of 17.5 and a span of 782.5 fit 800 pixels exactly, while
  // independently rounding them would incorrectly request 18 + 783 pixels.
  const skip = placement.destY - frameStart;
  const start = (origin + span * skip / frameSize) * sourceScale;
  const end = start + span * placement.height / frameSize * sourceScale;
  if (![start, end].every(Number.isFinite) || start < -1 || end > limit + 1) {
    throw new Error('A horizontal capture crop falls outside the screenshot. Keep the full record container inside the viewport and retry.');
  }
  const sourceStart = Math.max(0, start);
  const sourceSize = Math.min(limit, end) - sourceStart;
  if (sourceSize <= 0) throw new Error('A horizontal capture crop falls outside the screenshot.');
  return { start: sourceStart, size: sourceSize };
}

// Tiles arrive left-to-right for each vertical strip, then top-to-bottom.
export class GridStitcher extends ImageStitcher {
  async append(dataUrl, metrics) {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    try {
      const scale = bitmap.width / metrics.viewportWidth;
      if (Math.abs(bitmap.height / metrics.viewportHeight - scale) > 0.02) throw new Error('Screenshot dimensions do not match the page viewport.');
      const width = Math.round(metrics.totalWidth * scale);
      const height = Math.round(metrics.totalHeight * scale);
      checkedDimensions(width, height);
      if (!this.canvas) {
        this.scale = scale;
        this.canvas = new OffscreenCanvas(width, height);
        this.context = this.canvas.getContext('2d', { alpha: false });
        if (!this.context) throw new Error('Chrome could not allocate the wide screenshot canvas.');
        this.context.fillStyle = '#fff';
        this.context.fillRect(0, 0, width, height);
      } else if (width !== this.canvas.width || Math.abs(scale - this.scale) > 0.001) {
        throw new Error('The record width changed during all-columns capture. Wait for loading to finish and retry.');
      } else if (height !== this.canvas.height) {
        if (height < this.canvas.height) throw new Error('The record shrank during capture.');
        const expanded = new OffscreenCanvas(width, height);
        const context = expanded.getContext('2d', { alpha: false });
        if (!context) throw new Error('Chrome could not grow the wide screenshot canvas.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(this.canvas, 0, 0);
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas = expanded;
        this.context = context;
      }
      const vertical = framePlacement(metrics, scale, this.filled);
      if (!this.row) this.row = { offset: metrics.offset, filledX: 0, end: vertical.end, destY: vertical.destY };
      if (metrics.offset !== this.row.offset || vertical.end !== this.row.end) throw new Error('The record layout changed between horizontal tiles.');
      const horizontal = framePlacement({ offset: metrics.horizontalOffset, totalHeight: metrics.totalWidth,
        clip: { y: metrics.clip.x, height: metrics.clip.width } }, scale, this.row.filledX);
      const sourceX = sourceAxis(metrics.clip.x, metrics.clip.width, metrics.horizontalOffset,
        scale, scale, horizontal, bitmap.width);
      const sourceY = sourceAxis(metrics.clip.y, metrics.clip.height, metrics.offset,
        scale, bitmap.height / metrics.viewportHeight, vertical, bitmap.height);
      this.context.drawImage(bitmap, sourceX.start, sourceY.start, sourceX.size, sourceY.size,
        horizontal.destY, vertical.destY, horizontal.height, vertical.height);
      if (this.context.isContextLost?.()) throw new Error('Chrome ran out of Canvas resources. Try visible columns.');
      this.row.filledX = horizontal.end;
      if (this.row.filledX === width) {
        this.filled = this.row.end;
        this.row = undefined;
      }
    } finally {
      bitmap.close();
    }
  }

  async toPng() {
    if (this.row) throw new Error('Not all horizontal columns were captured. No PNG was exported.');
    return super.toPng();
  }

  dispose() {
    this.row = undefined;
    super.dispose();
  }
}
