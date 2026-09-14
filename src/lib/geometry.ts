/** Basic 2D geometry helpers. All coordinates are plain {x,y} objects. */
export interface Pt { x: number; y: number }
export type Polygon = Pt[];

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function bbox(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function bboxAll(polys: Polygon[]) {
  return bbox(polys.flat());
}

/** Signed area; positive when counter-clockwise in a y-up system. */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(poly: Polygon): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const b = bbox(poly);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Rotate a polygon (degrees) about a pivot, then translate. */
export function transformPolygon(poly: Polygon, rotationDeg: number, pivot: Pt, translate: Pt): Polygon {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return poly.map((p) => {
    const dx = p.x - pivot.x, dy = p.y - pivot.y;
    return { x: pivot.x + dx * c - dy * s + translate.x, y: pivot.y + dx * s + dy * c + translate.y };
  });
}

export function translatePolygon(poly: Polygon, d: Pt): Polygon {
  return poly.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
}

export function pointInPolygon(pt: Pt, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Ramer-Douglas-Peucker simplification for an open polyline. */
export function simplifyOpen(pts: Polygon, eps: number): Polygon {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out: Polygon = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** RDP for a closed polygon: split at the two most distant points. */
export function simplifyClosed(poly: Polygon, eps: number): Polygon {
  if (poly.length < 4) return poly.slice();
  let iA = 0, iB = 0, best = -1;
  // approximate diameter: farthest from point 0, then farthest from that
  for (let i = 1; i < poly.length; i++) { const d = dist(poly[0], poly[i]); if (d > best) { best = d; iA = i; } }
  best = -1;
  for (let i = 0; i < poly.length; i++) { const d = dist(poly[iA], poly[i]); if (d > best) { best = d; iB = i; } }
  const lo = Math.min(iA, iB), hi = Math.max(iA, iB);
  const seg1 = poly.slice(lo, hi + 1);
  const seg2 = poly.slice(hi).concat(poly.slice(0, lo + 1));
  const s1 = simplifyOpen(seg1, eps);
  const s2 = simplifyOpen(seg2, eps);
  const out = s1.slice(0, -1).concat(s2.slice(0, -1));
  return out.length >= 3 ? out : poly.slice();
}

/** Chaikin corner-cutting smoothing (closed). */
export function chaikinClosed(poly: Polygon, iterations = 1): Polygon {
  let cur = poly;
  for (let k = 0; k < iterations; k++) {
    const out: Polygon = [];
    for (let i = 0, n = cur.length; i < n; i++) {
      const p = cur[i], q = cur[(i + 1) % n];
      out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    cur = out;
  }
  return cur;
}

export function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}
export function ensureCW(poly: Polygon): Polygon {
  return signedArea(poly) > 0 ? poly.slice().reverse() : poly;
}

export function roundedRect(w: number, h: number, r: number, segments = 8): Polygon {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-9) return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const pts: Polygon = [];
  const corners: [number, number, number][] = [
    [w - r, h - r, 0], [r, h - r, Math.PI / 2], [r, r, Math.PI], [w - r, r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return pts;
}

export function circle(c: Pt, r: number, segments = 32): Polygon {
  const pts: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
