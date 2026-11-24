import { GridStitcher } from './grid-stitcher.js';

// Phase 3 owns its selected-element crop validation. The existing, tested
// grid compositor is used without modifying Phase 1 or Phase 2 processing.
export class ElementImageCropper extends GridStitcher {
  async appendElement(dataUrl, metrics, rowHeight) {
    const { clip, viewportWidth, viewportHeight }=metrics;
    if (!Number.isFinite(rowHeight) || rowHeight<=0 || rowHeight>clip.height+0.5 ||
        clip.x< -0.5 || clip.y< -0.5 || clip.x+clip.width>viewportWidth+0.5 || clip.y+rowHeight>viewportHeight+0.5) {
      throw new Error('The selected element crop is outside its visible viewport. No image was exported.');
    }
    return super.append(dataUrl,{...metrics,clip:{...clip,height:rowHeight}});
  }
}
