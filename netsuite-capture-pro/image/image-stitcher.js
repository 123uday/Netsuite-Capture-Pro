const MAX_DIMENSION = 30000;
const MAX_PIXELS = 40000000;

export function checkedDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('This record exceeds the safe canvas limit (30,000 pixels per side or 40 megapixels). Capture a shorter record or use visible capture.');
  }
  return { width, height };
}

export function framePlacement(metrics, scale, filled) {
  const start = Math.round(metrics.offset * scale);
  const end = Math.min(Math.round((metrics.offset + metrics.clip.height) * scale), Math.round(metrics.totalHeight * scale));
  if (start > filled + 1) throw new Error('A gap was detected between screenshots. Capture discarded.');
  const skip = Math.max(0, filled - start);
  const height = end - start - skip;
  if (height <= 0) throw new Error('Scrolling did not reveal any new pixels. Capture discarded.');
  return { sourceY: Math.round(metrics.clip.y * scale) + skip, destY: start + skip, height, end };
}

export function sourceRectangle(metrics, bitmap, placement) {
  const scaleX = bitmap.width / metrics.viewportWidth;
  const scaleY = bitmap.height / metrics.viewportHeight;
  // Source crops retain fractional pixel edges. Rounding the origin and size
  // separately can turn an exact edge (17.5 + 732.5 = 750) into 18 + 733 = 751.
  // Destination offsets stay integer so overlap removal remains contiguous.
  const frameStart = Math.round(metrics.offset * scaleX);
  const frameHeight = Math.round((metrics.offset + metrics.clip.height) * scaleX) - frameStart;
  if (frameHeight < 1) throw new Error('The captured section has no pixel height.');
  const skip = placement.destY - frameStart;
  const x = metrics.clip.x * scaleX;
  const y = (metrics.clip.y + metrics.clip.height * skip / frameHeight) * scaleY;
  const right = (metrics.clip.x + metrics.clip.width) * scaleX;
  const bottom = y + metrics.clip.height * placement.height / frameHeight * scaleY;
  // Permit only subpixel edge drift, never a materially out-of-view container.
  const tolerance = 1;
  if (![x, y, right, bottom].every(Number.isFinite) || x < -tolerance || y < -tolerance ||
      right > bitmap.width + tolerance || bottom > bitmap.height + tolerance) {
    throw new Error('The record container extends outside the screenshot. Keep the full container inside the browser viewport and retry.');
  }
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const width = Math.min(bitmap.width, right) - left;
  const height = Math.min(bitmap.height, bottom) - top;
  if (width <= 0 || height <= 0) throw new Error('The captured section is outside the screenshot.');
  return { x: left, y: top, width, height };
}

export class ImageStitcher {
  constructor() {
    this.filled = 0;
  }

  async append(dataUrl, metrics) {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    try {
      const scale = bitmap.width / metrics.viewportWidth;
      if (Math.abs(bitmap.height / metrics.viewportHeight - scale) > 0.02) {
        throw new Error('Screenshot dimensions do not match the page viewport.');
      }
      const width = Math.round(metrics.clip.width * scale);
      const height = Math.round(metrics.totalHeight * scale);
      checkedDimensions(width, height);
      if (!this.canvas) {
        this.scale = scale;
        this.canvas = new OffscreenCanvas(width, height);
        this.context = this.canvas.getContext('2d', { alpha: false });
        if (!this.context) throw new Error('Chrome could not allocate the screenshot canvas.');
      } else if (width !== this.canvas.width || Math.abs(scale - this.scale) > 0.001) {
        throw new Error('Screenshot width or scale changed during capture.');
      } else if (height !== this.canvas.height) {
        if (height < this.canvas.height) throw new Error('The record shrank during capture. Retry when it is stable.');
        const expanded = new OffscreenCanvas(width, height);
        const context = expanded.getContext('2d', { alpha: false });
        if (!context) throw new Error('Chrome could not grow the screenshot canvas.');
        context.drawImage(this.canvas, 0, 0);
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas = expanded;
        this.context = context;
      }
      const placement = framePlacement(metrics, scale, this.filled);
      const source = sourceRectangle(metrics, bitmap, placement);
      // Each frame uses its measured offset, including the clamped final scroll.
      // Only previously unseen rows are copied; overlap is never duplicated.
      this.context.drawImage(bitmap, source.x, source.y, source.width, source.height,
        0, placement.destY, width, placement.height);
      if (this.context.isContextLost?.()) throw new Error('Chrome ran out of Canvas resources. Try a shorter record.');
      this.filled = placement.end;
    } finally {
      bitmap.close();
    }
  }

  async toPng() {
    if (!this.canvas || this.filled !== this.canvas.height) throw new Error('The full record was not captured. No PNG was exported.');
    if (this.context.isContextLost?.()) throw new Error('Chrome lost the screenshot canvas. No PNG was exported.');
    let blob;
    try {
      // A service worker has no DOM canvas; this is the worker Canvas Blob API.
      blob = await this.canvas.convertToBlob({ type: 'image/png' });
    } catch {
      throw new Error('Chrome could not encode this image within available memory. Try a shorter record.');
    }
    if (!blob.size || blob.size > 64000000) throw new Error('The PNG exceeds the safe export size (64 MB). Try a shorter record.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 32768) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    }
    return `data:image/png;base64,${btoa(chunks.join(''))}`;
  }

  dispose() {
    if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
    this.canvas = undefined;
    this.context = undefined;
  }
}
