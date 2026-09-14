import type { Pt } from './geometry';

export interface PaperSize { id: string; label: string; w: number; h: number }

/** Common paper sizes in millimetres (portrait). */
export const PAPER_SIZES: PaperSize[] = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { id: 'letter', label: 'US Letter (8.5 × 11 in)', w: 215.9, h: 279.4 },
  { id: 'legal', label: 'US Legal (8.5 × 14 in)', w: 215.9, h: 355.6 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 279.4, h: 431.8 },
  { id: 'custom', label: 'Custom…', w: 200, h: 200 },
];

export function paperById(id: string): PaperSize {
  return PAPER_SIZES.find((p) => p.id === id) ?? PAPER_SIZES[0];
}

/**
 * Attempt to auto-detect the corners of a bright sheet of paper in an RGBA image.
 * Classical approach: luminance/saturation threshold -> largest connected component ->
 * convex hull -> reduce to 4 corners. Returns null if nothing convincing is found.
 */
export function detectPaperCorners(data: Uint8ClampedArray, width: number, height: number): Pt[] | null {
  // Downscale for speed
  const maxDim = 400;
  const s = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * s)), h = Math.max(1, Math.round(height * s));
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / s));
      const i = (sy * width + sx) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[y * w + x] = mx === 0 ? 0 : (mx - mn) / mx;
    }
  }
  // Otsu threshold on luminance
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[Math.min(255, Math.round(lum[i]))]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  const total = lum.length;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  thr = Math.max(thr, 120);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = lum[i] >= thr && sat[i] < 0.35 ? 1 : 0;

  // Largest connected component (4-neighbour flood fill)
  const label = new Int32Array(w * h).fill(-1);
  let bestLabel = -1, bestCount = 0, cur = 0;
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    let count = 0;
    stack.push(i); label[i] = cur;
    while (stack.length) {
      const p = stack.pop()!; count++;
      const x = p % w, y = (p / w) | 0;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
      for (let k = 0; k < 4; k++) if (ok[k] && mask[nb[k]] && label[nb[k]] === -1) { label[nb[k]] = cur; stack.push(nb[k]); }
    }
    if (count > bestCount) { bestCount = count; bestLabel = cur; }
    cur++;
  }
  if (bestLabel < 0 || bestCount < w * h * 0.03) return null;

  // Boundary points of the component
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (label[i] !== bestLabel) continue;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      label[i - 1] !== bestLabel || label[i + 1] !== bestLabel || label[i - w] !== bestLabel || label[i + w] !== bestLabel;
    if (edge) pts.push({ x, y });
  }
  if (pts.length < 4) return null;
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  const quad = hullToQuad(hull);
  if (!quad) return null;
  // Sanity: quad area vs component count
  const area = Math.abs(polyArea(quad));
  if (area < bestCount * 0.6 || area > bestCount * 1.8) return null;
  return quad.map((p) => ({ x: p.x / s, y: p.y / s }));
}

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; }
  return a / 2;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Pick the 4 hull vertices forming the maximum-area quadrilateral (hull is small, brute force is fine after decimation). */
function hullToQuad(hull: Pt[]): Pt[] | null {
  let h = hull;
  if (h.length > 40) { const step = h.length / 40; h = Array.from({ length: 40 }, (_, i) => hull[Math.floor(i * step)]); }
  const n = h.length;
  if (n < 4) return null;
  let best = 0, bq: Pt[] | null = null;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q = [h[a], h[b], h[c], h[d]];
    const ar = Math.abs(polyArea(q));
    if (ar > best) { best = ar; bq = q; }
  }
  return bq;
}
