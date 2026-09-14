import { chaikinClosed, simplifyClosed, type Polygon, type Pt } from './geometry';

/** Binary mask helpers (Uint8Array, 1 = foreground). */
export interface Mask { data: Uint8Array; width: number; height: number }

export function morphDilate(m: Mask, r: number): Mask {
  return morph(m, r, true);
}
export function morphErode(m: Mask, r: number): Mask {
  return morph(m, r, false);
}
/** Separable square structuring element (fast, good enough for cleanup). */
function morph(m: Mask, r: number, dilate: boolean): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= w ? 0 : m.data[y * w + xx];
        if (s === want) { v = want; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (s === want) { v = want; break; }
      }
      out[y * w + x] = v;
    }
  }
  return { data: out, width: w, height: h };
}
export function morphClose(m: Mask, r: number): Mask { return morphErode(morphDilate(m, r), r); }
export function morphOpen(m: Mask, r: number): Mask { return morphDilate(morphErode(m, r), r); }

/** Keep only the connected component (8-neighbour) containing the seed. */
export function componentAt(m: Mask, seed: Pt): Mask | null {
  const { width: w, height: h } = m;
  const sx = Math.round(seed.x), sy = Math.round(seed.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !m.data[sy * w + sx]) return null;
  const out = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  out[sy * w + sx] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (m.data[q] && !out[q]) { out[q] = 1; stack.push(q); }
    }
  }
  return { data: out, width: w, height: h };
}

/** Fill interior holes: anything not reachable from the border background becomes foreground. */
export function fillHoles(m: Mask): Mask {
  const { width: w, height: h } = m;
  const reach = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => { if (!m.data[p] && !reach[p]) { reach[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = reach[i] ? 0 : 1;
  return { data: out, width: w, height: h };
}

export function maskUnion(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] | b.data[i];
  return { data: out, width: a.width, height: a.height };
}
export function maskSubtract(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] && !b.data[i] ? 1 : 0;
  return { data: out, width: a.width, height: a.height };
}
export function maskArea(m: Mask): number { let n = 0; for (let i = 0; i < m.data.length; i++) n += m.data[i]; return n; }

/**
 * Trace the outer boundary of the first (top-most, left-most) foreground component
 * using Moore neighbourhood tracing with Jacob's stopping criterion.
 * Returns pixel-centre coordinates in traversal order.
 */
export function traceOuterContour(m: Mask): Polygon {
  const { width: w, height: h, data } = m;
  let start = -1;
  for (let i = 0; i < data.length; i++) if (data[i]) { start = i; break; }
  if (start < 0) return [];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  // Moore neighbourhood, clockwise (screen coords, y down) starting from west
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const dirIndex = (dx: number, dy: number) => dirs.findIndex((d) => d[0] === dx && d[1] === dy);
  const sx = start % w, sy = (start / w) | 0;
  const contour: Polygon = [];
  let cx = sx, cy = sy;
  let scanFrom = 0; // west: the pixel left of the start is background by construction
  let firstDir = -1;
  const maxSteps = w * h * 4;
  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (scanFrom + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (!at(nx, ny)) continue;
      if (step > 0 && cx === sx && cy === sy && d === firstDir) return contour; // Jacob's criterion
      if (step === 0) firstDir = d;
      contour.push({ x: cx, y: cy });
      // backtrack pixel = the background neighbour examined just before d, expressed relative to the new pixel
      const bd = (d + 7) % 8;
      const bx = cx + dirs[bd][0] - nx, by = cy + dirs[bd][1] - ny;
      const bi = dirIndex(bx, by);
      scanFrom = bi >= 0 ? bi : (d + 5) % 8;
      cx = nx; cy = ny;
      moved = true;
      break;
    }
    if (!moved) { contour.push({ x: cx, y: cy }); break; } // isolated pixel
  }
  return contour;
}

/** Full mask -> clean polygon pipeline. eps in pixels. */
export function maskToPolygon(m: Mask, eps = 1.2, smoothIters = 1): Polygon {
  const raw = traceOuterContour(m);
  if (raw.length < 3) return raw;
  const simp = simplifyClosed(raw, eps);
  return smoothIters > 0 ? chaikinClosed(simp, smoothIters) : simp;
}

/** Rasterise a polygon (pixel coords) into a mask. */
export function polygonToMask(poly: Polygon, width: number, height: number): Mask {
  const data = new Uint8Array(width * height);
  const n = poly.length;
  if (n < 3) return { data, width, height };
  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) data[y * width + x] = 1;
    }
  }
  return { data, width, height };
}
