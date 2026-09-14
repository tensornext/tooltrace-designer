import { componentAt, fillHoles, maskSubtract, maskUnion, morphClose, morphOpen, type Mask } from '../contour';
import type { SegmentInput, Segmenter } from './types';

/**
 * Classical click-to-segment. The use case (tools lying on a sheet of paper, photographed
 * from above) makes the background very well behaved: the paper is bright and unsaturated.
 * Strategy:
 *   1. Estimate the background colour from the paper region (median of a sparse sample).
 *   2. Foreground = pixels whose colour distance from the background exceeds a tolerance,
 *      OR pixels that are locally similar to the clicked pixel (region grow) when the tool
 *      itself is light coloured.
 *   3. Morphological open/close, take the connected component under each positive marker,
 *      union them, subtract components under negative markers, fill holes.
 */
export class ClassicalSegmenter implements Segmenter {
  readonly id = 'classical' as const;

  async segment(input: SegmentInput): Promise<Mask | null> {
    const { data, width: w, height: h, markers, paperPx } = input;
    const positives = markers.filter((m) => m.positive);
    if (!positives.length) return null;

    const bg = estimateBackground(data, w, h, paperPx);
    const tol = 18 + input.tolerance * 120; // colour distance threshold in 0..441 RGB space
    const bgMask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < bgMask.length; i++, p += 4) {
      const dr = data[p] - bg[0], dg = data[p + 1] - bg[1], db = data[p + 2] - bg[2];
      bgMask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > tol ? 1 : 0;
    }
    let fg: Mask = { data: bgMask, width: w, height: h };
    // Cleanup radius: ~0.15 % of the larger dimension (≈ 0.5 mm at 4 px/mm). Small enough to keep
    // concave corners of narrow tools, large enough to drop sensor noise and paper texture.
    const r = Math.max(1, Math.round(Math.max(w, h) * 0.0015));
    fg = morphOpen(fg, r);
    fg = morphClose(fg, r);

    let result: Mask | null = null;
    for (const m of positives) {
      let comp = componentAt(fg, m);
      if (!comp) {
        // The click landed on something that looks like background (e.g. a white handle):
        // fall back to region growing from the click in colour space.
        comp = regionGrow(data, w, h, m.x, m.y, 14 + input.tolerance * 60);
        if (comp) comp = morphClose(comp, r);
      }
      if (comp) result = result ? maskUnion(result, comp) : comp;
    }
    if (!result) return null;
    for (const m of markers.filter((x) => !x.positive)) {
      const comp = componentAt(fg, m) ?? regionGrow(data, w, h, m.x, m.y, 14 + input.tolerance * 60);
      if (comp) result = maskSubtract(result, comp);
    }
    result = fillHoles(result);
    return result;
  }
}

export function estimateBackground(
  data: Uint8ClampedArray, w: number, h: number, paper?: { x: number; y: number; w: number; h: number },
): [number, number, number] {
  const region = paper ?? { x: 0, y: 0, w, h };
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const n = 48;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = Math.round(region.x + ((i + 0.5) / n) * region.w);
    const y = Math.round(region.y + ((j + 0.5) / n) * region.h);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = (y * w + x) * 4;
    // paper pixels are bright and unsaturated; ignore obvious tool pixels
    const mx = Math.max(data[p], data[p + 1], data[p + 2]), mn = Math.min(data[p], data[p + 1], data[p + 2]);
    if (mx < 100 || (mx - mn) / (mx || 1) > 0.4) continue;
    rs.push(data[p]); gs.push(data[p + 1]); bs.push(data[p + 2]);
  }
  const med = (a: number[]) => { if (!a.length) return 235; a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/** Flood fill in RGB space from a seed, accepting pixels within `tol` of the seed colour. */
export function regionGrow(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol: number): Mask | null {
  sx = Math.round(sx); sy = Math.round(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const s = (sy * w + sx) * 4;
  const sr = data[s], sg = data[s + 1], sb = data[s + 2];
  const out = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  out[sy * w + sx] = 1;
  const t2 = tol * tol;
  let count = 0;
  const limit = w * h * 0.5;
  while (stack.length) {
    const p = stack.pop()!;
    if (++count > limit) return null;
    const x = p % w, y = (p / w) | 0;
    const nb = [p - 1, p + 1, p - w, p + w];
    const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
    for (let k = 0; k < 4; k++) {
      if (!ok[k] || out[nb[k]]) continue;
      const q = nb[k] * 4;
      const dr = data[q] - sr, dg = data[q + 1] - sg, db = data[q + 2] - sb;
      if (dr * dr + dg * dg + db * db <= t2) { out[nb[k]] = 1; stack.push(nb[k]); }
    }
  }
  return { data: out, width: w, height: h };
}
